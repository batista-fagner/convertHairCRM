import { Logger } from '@nestjs/common';
import axios from 'axios';
import { IgPost, IgProfile, ScrapeCreatorsClient } from '../enrichment/scrape-creators.client';

/**
 * Coleta os FATOS da auditoria (nada de IA aqui): perfil, reels, destaques,
 * Biblioteca de Anúncios, link da bio e transcrição de alguns reels. Os
 * números da capa do PDF saem daqui — a IA só interpreta, não inventa número.
 *
 * Créditos da Scrape Creators por auditoria: perfil 1 + reels 1 + destaques 1
 * + busca de anúncios 1-2 + anúncios da página 0-1 + transcrições 3 ≈ 8-9.
 * Stories não existem na Scrape Creators — sempre "não disponível".
 */

const DAY = 86400;
const TRANSCRIPTS = 3; // 2 melhores + 1 pior reel

export interface AuditReel {
  code: string;
  takenAt: number;
  plays: number | null;
  likes: number;
  comments: number;
  caption: string;
}

export interface AuditData {
  collectedAt: string;
  profile: {
    username: string;
    fullName: string;
    bio: string;
    category: string | null;
    isBusiness: boolean;
    isPrivate: boolean;
    isVerified: boolean;
    followers: number | null;
    following: number | null;
    mediaCount: number | null;
    externalUrl: string | null;
    links: { url: string; type: string }[];
    businessPhone: string | null;
    city: string | null;
    /** Foto em base64 — vai pra IA e pro PDF (URL do Instagram expira). */
    picDataUrl: string | null;
  };
  posts: { code: string; kind: string; takenAt: number; likes: number; comments: number; plays: number | null; caption: string }[];
  reels: AuditReel[];
  stats: {
    reelsAnalisados: number;
    mediaViews: number | null;
    medianaViews: number | null;
    viewsPorSeguidorPct: number | null;
    melhores: AuditReel[];
    piores: AuditReel[];
    reelsUltimos7Dias: number;
    reelsUltimos30Dias: number;
    postsUltimos7Dias: number;
    postsUltimos30Dias: number;
    diasDesdeUltimaPublicacao: number | null;
    maiorIntervaloSemPostarDias: number | null;
    mediaPostsPorSemana: number | null;
    taxaEngajamentoPct: number | null;
  };
  highlights: { available: boolean; count: number; titles: string[] };
  ads: {
    status: 'utiliza' | 'nao_encontrado' | 'nao_confirmado';
    pageName: string | null;
    pageId: string | null;
    activeCount: number;
    samples: { body: string; platforms: string[]; startDate: string | null; cta: string | null; linkUrl: string | null }[];
    note: string;
  };
  site: {
    url: string | null;
    finalUrl: string | null;
    reachable: boolean;
    kind: 'nenhum' | 'whatsapp' | 'agregador' | 'loja' | 'site';
    hasWhatsapp: boolean;
    hasCatalog: boolean;
    hasCart: boolean;
    title: string | null;
    links: string[];
    textSnippet: string;
  };
  whatsappNaBio: boolean;
  /** Número de telefone escrito no texto da bio (não é link clicável). */
  telefoneNaBio: boolean;
  transcripts: { code: string; plays: number | null; group: 'melhor' | 'pior'; text: string }[];
  stories: null;
  /** Capas (base64) dos melhores/piores reels — só pra IA olhar, não vão pro banco. */
  coverDataUrls?: { code: string; group: 'melhor' | 'pior'; dataUrl: string }[];
}

const PHONE_RE = /\(?\b\d{2}\)?[\s.-]?9[\s.]?\d{4}[\s.-]?\d{4}\b/;
const WHATS_RE = /wa\.me|api\.whatsapp|whatsapp\.com\/(send|message)|chat\.whatsapp/i;
const AGGREGATOR_RE = /linktr\.ee|beacons\.ai|linkbio|bio\.link|lnk\.bio|campsite\.bio|taplink|linkin\.bio|msha\.ke|link\.me|hoo\.be/i;
const CART_RE = /carrinho|add[-_ ]to[-_ ]cart|adicionar ao carrinho|comprar agora|checkout|finalizar compra|nuvemshop|shopify|lojaintegrada|tray\.com|yampi|wix stores|vtex/i;
const CATALOG_RE = /cat[aá]logo|produtos|collections?\b|cole[cç][aã]o|categoria|\/produto|loja/i;

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export class IgAuditCollector {
  private readonly logger = new Logger('IgAuditCollector');

  constructor(private readonly sc: ScrapeCreatorsClient) {}

  async collect(input: string, onProgress: (step: string) => Promise<void>): Promise<AuditData> {
    await onProgress('Buscando o perfil');
    const resolved = await this.sc.resolve(input);
    if (resolved.status === 'not_found') {
      const hint = resolved.candidates.length ? ` Talvez seja: ${resolved.candidates.map((c) => '@' + c.username).join(', ')}` : '';
      throw new Error(`Perfil não encontrado.${hint}`);
    }
    const p = resolved.profile;
    if (resolved.status === 'private') throw new Error(`O perfil @${p.username} é privado — não dá pra analisar.`);
    // Perfil tem publicações mas não veio nenhuma (Instagram bloqueou a leitura):
    // nunca seguir — a análise diria "0 postagens", o que seria falso no PDF.
    if ((p.mediaCount ?? 0) > 0 && !p.posts.length && !p.reels.length) {
      throw new Error('O Instagram não deixou ler as publicações desse perfil agora. Tente de novo em alguns minutos.');
    }

    const now = Math.floor(Date.now() / 1000);
    const reels: AuditReel[] = p.reels.map((r) => ({
      code: r.code,
      takenAt: r.takenAt,
      plays: r.plays,
      likes: r.likes,
      comments: r.comments,
      // reels endpoint não traz legenda; a do feed (mesmo code) serve
      caption: (r.caption || p.posts.find((x) => x.code === r.code)?.caption || '').slice(0, 300),
    }));

    await onProgress('Lendo destaques e anúncios');
    const [highlights, ads, picDataUrl] = await Promise.all([
      this.highlights(p.userId),
      this.ads(p),
      this.download(p.profilePicUrl),
    ]);

    await onProgress('Abrindo o link da bio');
    const siteUrl = p.externalUrl || p.links[0]?.url || null;
    const site = await this.site(siteUrl);

    const stats = this.stats(p, reels, now);

    await onProgress('Ouvindo os reels');
    const transcripts = await this.transcripts(stats.melhores.slice(0, 2), stats.piores.slice(0, 1));
    const coverDataUrls = await this.covers(p.reels, stats);

    const linkText = [p.biography, ...p.links.map((l) => l.url), p.externalUrl || ''].join(' ');
    return {
      collectedAt: new Date().toISOString(),
      profile: {
        username: p.username,
        fullName: p.fullName,
        bio: p.biography,
        category: p.category,
        isBusiness: p.isBusiness,
        isPrivate: p.isPrivate,
        isVerified: p.isVerified,
        followers: p.followers,
        following: p.following,
        mediaCount: p.mediaCount,
        externalUrl: p.externalUrl,
        links: p.links,
        businessPhone: p.businessPhone,
        city: p.city,
        picDataUrl,
      },
      posts: p.posts.slice(0, 12).map((x: IgPost) => ({
        code: x.code,
        kind: x.kind,
        takenAt: x.takenAt,
        likes: x.likes,
        comments: x.comments,
        plays: x.plays,
        caption: (x.caption || '').slice(0, 300),
      })),
      reels,
      stats,
      highlights,
      ads,
      site,
      telefoneNaBio: PHONE_RE.test(p.biography || ''),
      whatsappNaBio: WHATS_RE.test(linkText) || /whats/i.test(p.biography) || !!p.businessPhone || site.kind === 'whatsapp',
      transcripts,
      stories: null,
      coverDataUrls,
    };
  }

  private stats(p: IgProfile, reels: AuditReel[], now: number): AuditData['stats'] {
    const withPlays = reels.filter((r) => typeof r.plays === 'number') as (AuditReel & { plays: number })[];
    const plays = withPlays.map((r) => r.plays);
    const avg = plays.length ? Math.round(plays.reduce((a, b) => a + b, 0) / plays.length) : null;
    const sorted = [...withPlays].sort((a, b) => b.plays - a.plays);

    // Datas de tudo que ela publicou (feed + reels), sem repetir o mesmo code.
    const seen = new Set<string>();
    const dates = [...p.posts, ...p.reels]
      .filter((x) => x.takenAt && !seen.has(x.code) && seen.add(x.code))
      .map((x) => x.takenAt)
      .sort((a, b) => b - a);
    // Frequência só pela janela recente (90 dias): post FIXADO antigo aparece
    // no topo do perfil e, se entrasse na conta, inventaria "401 dias sem postar".
    const WINDOW = 90;
    const recentDates = dates.filter((d) => now - d <= WINDOW * DAY);
    let maxGap: number | null = null;
    for (let i = 0; i < recentDates.length - 1; i++) {
      const gap = Math.floor((recentDates[i] - recentDates[i + 1]) / DAY);
      if (maxGap === null || gap > maxGap) maxGap = gap;
    }
    // Janela efetiva: se tudo que lemos é mais novo que 90 dias, usa do mais antigo lido até hoje.
    // Janela efetiva = do mais antigo que lemos (dentro dos 90 dias) até hoje —
    // só lemos as ~12 últimas publicações, então não dá pra dividir por 90 sempre.
    const oldestRecent = recentDates.length ? recentDates[recentDates.length - 1] : null;
    const windowDays = oldestRecent ? Math.max(7, (now - oldestRecent) / DAY) : WINDOW;

    const recent = p.posts.slice(0, 12);
    const engagement =
      p.followers && recent.length
        ? Math.round((recent.reduce((a, x) => a + x.likes + x.comments, 0) / recent.length / p.followers) * 1000) / 10
        : null;

    return {
      reelsAnalisados: reels.length,
      mediaViews: avg,
      medianaViews: median(plays),
      viewsPorSeguidorPct: avg !== null && p.followers ? Math.round((avg / p.followers) * 1000) / 10 : null,
      melhores: sorted.slice(0, 3),
      // Só faz sentido falar de "piores" com reels suficientes pra não repetir os melhores.
      piores: sorted.length > 3 ? sorted.slice(3).slice(-2).reverse() : [],
      reelsUltimos7Dias: reels.filter((r) => now - r.takenAt <= 7 * DAY).length,
      reelsUltimos30Dias: reels.filter((r) => now - r.takenAt <= 30 * DAY).length,
      postsUltimos7Dias: dates.filter((d) => now - d <= 7 * DAY).length,
      postsUltimos30Dias: dates.filter((d) => now - d <= 30 * DAY).length,
      diasDesdeUltimaPublicacao: dates.length ? Math.floor((now - dates[0]) / DAY) : null,
      maiorIntervaloSemPostarDias: maxGap,
      mediaPostsPorSemana: dates.length ? Math.round((recentDates.length / windowDays) * 7 * 10) / 10 : null,
      taxaEngajamentoPct: engagement,
    };
  }

  private async highlights(userId: string): Promise<AuditData['highlights']> {
    const { status, data } = await this.sc.request('/v1/instagram/user/highlights', { user_id: userId }, 30000);
    if (status !== 200 || !Array.isArray(data?.highlights)) return { available: false, count: 0, titles: [] };
    // Títulos às vezes vêm em fonte "estilizada" (𝘊𝘭𝘪𝘦𝘯𝘵𝘦𝘴) — NFKC volta pra letra normal.
    const titles = data.highlights.map((h: any) => String(h.title || '').normalize('NFKC').trim()).filter(Boolean);
    return { available: true, count: data.highlights.length, titles };
  }

  /**
   * Biblioteca de Anúncios: acha a página pelo @ do Instagram (campo
   * ig_username da busca). Achou a página → conta os anúncios ATIVOS. Não
   * achou a página com segurança → "não foi possível confirmar" (nunca
   * "não anuncia": ausência de anúncio ativo ≠ nunca investiu).
   */
  private async ads(p: IgProfile): Promise<AuditData['ads']> {
    const none = (status: AuditData['ads']['status'], note: string): AuditData['ads'] => ({
      status, pageName: null, pageId: null, activeCount: 0, samples: [], note,
    });
    const queries = [p.username, p.fullName].filter((q, i, a) => q && q.length >= 3 && a.indexOf(q) === i).slice(0, 2);
    let page: any = null;
    for (const q of queries) {
      const { status, data } = await this.sc.request('/v1/facebook/adLibrary/search/companies', { query: q }, 30000);
      const results: any[] = status === 200 && Array.isArray(data?.searchResults) ? data.searchResults : [];
      page = results.find((r) => String(r.ig_username || '').toLowerCase() === p.username.toLowerCase());
      if (page) break;
    }
    if (!page) return none('nao_confirmado', 'Não achamos uma página do Facebook ligada a esse Instagram na Biblioteca de Anúncios.');

    const { status, data } = await this.sc.request(
      '/v1/facebook/adLibrary/company/ads',
      { pageId: page.page_id, status: 'ACTIVE', country: 'ALL', trim: true },
      45000,
    );
    if (status !== 200) return { ...none('nao_confirmado', 'A Biblioteca de Anúncios não respondeu.'), pageName: page.name, pageId: page.page_id };
    const list: any[] = data?.results || data?.ads || data?.searchResults || [];
    const active = list.filter((a) => a?.is_active !== false);
    if (!active.length) {
      return {
        status: 'nao_encontrado', pageName: page.name, pageId: String(page.page_id), activeCount: 0, samples: [],
        note: 'Página encontrada, mas sem anúncios ativos agora (pode já ter anunciado antes).',
      };
    }
    return {
      status: 'utiliza',
      pageName: page.name,
      pageId: String(page.page_id),
      activeCount: active.length,
      samples: active.slice(0, 3).map((a) => {
        const snap = a.snapshot || {};
        const body = snap.body?.text || snap.body || snap.cards?.[0]?.body || '';
        return {
          body: String(typeof body === 'string' ? body : '').slice(0, 300),
          platforms: a.publisher_platform || a.publisherPlatform || [],
          startDate: a.start_date_string || (a.start_date ? new Date(a.start_date * 1000).toISOString().slice(0, 10) : null),
          cta: snap.cta_text || null,
          linkUrl: snap.link_url || null,
        };
      }),
      note: `${active.length} anúncio(s) ativo(s) na Biblioteca de Anúncios.`,
    };
  }

  private async site(url: string | null): Promise<AuditData['site']> {
    const base: AuditData['site'] = {
      url, finalUrl: null, reachable: false, kind: 'nenhum', hasWhatsapp: false, hasCatalog: false, hasCart: false, title: null, links: [], textSnippet: '',
    };
    if (!url) return base;
    if (WHATS_RE.test(url)) return { ...base, kind: 'whatsapp', hasWhatsapp: true, reachable: true, finalUrl: url };
    try {
      const res = await axios.get(url, {
        timeout: 12000,
        maxRedirects: 5,
        responseType: 'text',
        maxContentLength: 3 * 1024 * 1024,
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
        validateStatus: () => true,
      });
      const html = String(res.data || '');
      const finalUrl: string = res.request?.res?.responseUrl || url;
      const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim().slice(0, 120) || null;
      const hrefs = Array.from(html.matchAll(/href=["']([^"']+)["']/gi))
        .map((m) => m[1])
        .filter((h) => /^https?:/i.test(h))
        .filter((h, i, a) => a.indexOf(h) === i);
      const text = html
        .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const all = `${finalUrl} ${html.slice(0, 400000)}`;
      const isAggregator = AGGREGATOR_RE.test(finalUrl);
      const hasCart = CART_RE.test(all);
      return {
        url,
        finalUrl,
        reachable: res.status >= 200 && res.status < 400,
        kind: isAggregator ? 'agregador' : hasCart ? 'loja' : 'site',
        hasWhatsapp: WHATS_RE.test(all),
        hasCatalog: CATALOG_RE.test(text) || hasCart,
        hasCart,
        title,
        links: hrefs.filter((h) => !/fonts\.|googleapis|gstatic|cdn|\.css|\.js(\?|$)|facebook\.com\/tr|schema\.org|w3\.org/i.test(h)).slice(0, 12),
        textSnippet: text.slice(0, 700),
      };
    } catch (err: any) {
      this.logger.warn(`Link da bio ${url} não abriu: ${err.message}`);
      return { ...base, kind: AGGREGATOR_RE.test(url) ? 'agregador' : 'site' };
    }
  }

  private async transcripts(best: AuditReel[], worst: AuditReel[]): Promise<AuditData['transcripts']> {
    const items = [
      ...best.map((r) => ({ r, group: 'melhor' as const })),
      ...worst.filter((w) => !best.some((b) => b.code === w.code)).map((r) => ({ r, group: 'pior' as const })),
    ].slice(0, TRANSCRIPTS);
    const out = await Promise.all(
      items.map(async ({ r, group }) => {
        const { status, data } = await this.sc.request(
          '/v2/instagram/media/transcript',
          { url: `https://www.instagram.com/reel/${r.code}/`, cache_max_age: '30d' },
          60000,
        );
        const text = status === 200 ? (data?.transcripts || []).map((t: any) => t?.text || '').join(' ').trim() : '';
        return { code: r.code, plays: r.plays, group, text: text ? text.slice(0, 600) : '(sem fala no vídeo)' };
      }),
    );
    return out;
  }

  private async covers(reels: IgPost[], stats: AuditData['stats']): Promise<AuditData['coverDataUrls']> {
    const picks = [
      ...stats.melhores.slice(0, 2).map((r) => ({ code: r.code, group: 'melhor' as const })),
      ...stats.piores.slice(0, 2).map((r) => ({ code: r.code, group: 'pior' as const })),
    ].filter((x, i, a) => a.findIndex((y) => y.code === x.code) === i);
    const out: NonNullable<AuditData['coverDataUrls']> = [];
    for (const pick of picks) {
      const url = reels.find((r) => r.code === pick.code)?.imageUrl;
      const dataUrl = await this.download(url);
      if (dataUrl) out.push({ ...pick, dataUrl });
    }
    return out;
  }

  private async download(url?: string | null): Promise<string | null> {
    if (!url) return null;
    try {
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
      const type = String(res.headers['content-type'] || 'image/jpeg').split(';')[0];
      if (!type.startsWith('image/')) return null;
      return `data:${type};base64,${Buffer.from(res.data).toString('base64')}`;
    } catch {
      return null;
    }
  }
}
