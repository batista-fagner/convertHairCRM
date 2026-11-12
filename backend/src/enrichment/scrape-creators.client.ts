import { Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

const BASE_URL = 'https://api.scrapecreators.com';

export interface IgPost {
  code: string;
  kind: 'reel' | 'foto' | 'carrossel' | 'video';
  caption: string;
  takenAt: number; // unix (s)
  likes: number;
  comments: number;
  plays: number | null;
  imageUrl: string;
}

export interface IgProfile {
  userId: string;
  username: string;
  fullName: string;
  biography: string;
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
  businessEmail: string | null;
  city: string | null;
  /** URL da foto de perfil no CDN do Instagram — assinada, expira em dias. */
  profilePicUrl: string | null;
  posts: IgPost[];
  reels: IgPost[];
  /** De onde veio o perfil: completo (com posts) ou só o básico (reserva). */
  source: 'profile' | 'basic';
  /** Como chegamos no @: digitado certo, deduzido do que ela escreveu (nome sem espaço, e-mail) ou pela busca. */
  resolvedBy: 'handle' | 'guess' | 'search';
}

export type ResolveResult =
  | { status: 'ok'; profile: IgProfile }
  | { status: 'private'; profile: IgProfile }
  | { status: 'not_found'; candidates: { username: string; fullName: string; followers: number | null; bio: string }[] };

const HAIR_WORDS = /cabel|mega ?hair|\bhair|alongament|extens[aã]o|extens(?:õ|o)es|peruc|\blaces?\b|tran[cç]as?\b|sal[aã]o|cachos|capilar|\btelas?\b|\bfitas?\b|queratina|micro ?link|\bwigs?\b|beauty|beleza/i;

/** "Nilda Madureira" → "nildamadureira"; tira acento e tudo que não for letra/número. */
function norm(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * O que a pessoa digitou pode vir como @, link, e-mail ou nome. Devolve o @
 * quando dá pra confiar que é um (só letras, números, ponto e _), senão null —
 * aí o jeito é procurar pela busca do Instagram.
 */
export function handleFromInput(raw: string): string | null {
  let s = (raw || '').trim();
  const url = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (url) s = url[1];
  s = s.replace(/^@+/, '').replace(/\/+$/, '').trim();
  // Menos de 3 letras não é @ de ninguém (ex.: "s" de "sim") — analisar @s seria outra pessoa.
  if (/^[A-Za-z0-9._]{3,30}$/.test(s)) return s.toLowerCase();
  return null;
}

/** Distância de edição — aceita @ digitado com 1-2 letras trocadas ("vascincelos" ~ "vasconcelos"). */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * Quando não veio um @ de verdade, o palpite mais comum de acertar: a parte
 * antes do @ de um e-mail, ou o nome sem espaço/acento ("Sheila Alongamentos"
 * → "sheilaalongamentos").
 */
export function guessHandleFromInput(raw: string): string | null {
  const s = (raw || '').trim();
  const email = s.match(/^([A-Za-z0-9._]+)@[^@\s]+\.[a-z]{2,}$/i);
  if (email) return email[1].toLowerCase().slice(0, 30);
  const squashed = norm(s);
  return squashed.length >= 4 && squashed.length <= 30 ? squashed : null;
}

export class ScrapeCreatorsClient {
  private readonly logger = new Logger('ScrapeCreators');

  /**
   * reelsLimit: quantos reels dela guardar (enriquecimento usa 8; auditoria usa mais).
   * includeCollabs: conta posts/reels em parceria (o dono é a outra conta) —
   * a auditoria quer, porque aparecem no perfil dela; o enriquecimento não.
   */
  constructor(
    private readonly apiKey: string,
    private readonly opts: { reelsLimit?: number; includeCollabs?: boolean } = {},
  ) {}

  /** Chamada crua pra outros endpoints da Scrape Creators (auditoria: destaques, anúncios, transcrição). */
  request(path: string, params: Record<string, any>, timeout = 45000) {
    return this.get(path, params, timeout);
  }

  get configured() {
    return !!this.apiKey;
  }

  private async get(path: string, params: Record<string, any>, timeout = 45000): Promise<{ status: number; data: any }> {
    try {
      const res = await axios.get(`${BASE_URL}${path}`, {
        params,
        headers: { 'x-api-key': this.apiKey },
        timeout,
        validateStatus: () => true,
      });
      return { status: res.status, data: res.data };
    } catch (err) {
      const e = err as AxiosError;
      this.logger.warn(`${path} falhou: ${e.message}`);
      return { status: 0, data: null };
    }
  }

  /**
   * Acha o perfil a partir do que a pessoa digitou. Ordem: perfil completo
   * pelo @ → (Instagram bloqueou) de novo → busca pra achar o userId → perfil
   * básico. Se o @ não existe ou veio como nome/e-mail, a busca escolhe o
   * resultado — só aceita quando bate com segurança, senão devolve os
   * candidatos pra alguém conferir à mão.
   */
  async resolve(rawInput: string, leadName?: string): Promise<ResolveResult> {
    if (norm(rawInput).length < 3) return { status: 'not_found', candidates: [] };
    const handle = handleFromInput(rawInput);
    const guess = handle ? null : guessHandleFromInput(rawInput);

    for (const [h, by] of [[handle, 'handle'], [guess, 'guess']] as const) {
      if (!h) continue;
      const full = await this.fetchFullProfile(h);
      if (full.kind === 'ok' || full.kind === 'private') return this.withReels(full.profile, by, full.kind);
      if (full.kind === 'blocked') {
        // Perfil completo falhou por bloqueio do Instagram: o básico só aceita userId.
        const found = await this.search(h);
        const hit = found.find((p) => norm(p.username) === norm(h));
        if (hit?.id) {
          const basic = await this.fetchBasicProfile(hit.id);
          if (basic) return this.withReels(basic, by, basic.isPrivate ? 'private' : 'ok');
        }
      }
    }

    // Não é um @ válido (nome, e-mail, frase) ou o @ não existe: busca.
    const query = handle || this.queryFromInput(rawInput);
    if (!query) return { status: 'not_found', candidates: [] };
    const results = await this.search(query);
    const pick = this.pickFromSearch(results, rawInput, leadName);
    if (pick) {
      const full = await this.fetchFullProfile(pick.username);
      if (full.kind === 'ok' || full.kind === 'private') return this.withReels(full.profile, 'search', full.kind);
      const basic = await this.fetchBasicProfile(pick.id);
      if (basic) return this.withReels(basic, 'search', basic.isPrivate ? 'private' : 'ok');
    }
    return {
      status: 'not_found',
      candidates: results
        .filter((p) => HAIR_WORDS.test(`${p.username} ${p.full_name} ${p.biography || ''}`))
        .slice(0, 3)
        .map((p) => ({ username: p.username, fullName: p.full_name || '', followers: p.follower_count ?? null, bio: (p.biography || '').slice(0, 80) })),
    };
  }

  /** E-mail vira a parte antes do @; o resto vai como texto pra busca. */
  private queryFromInput(raw: string): string {
    const s = (raw || '').trim();
    const email = s.match(/^([^@\s]+)@[^@\s]+\.[a-z]{2,}$/i);
    if (email) return email[1];
    return s.replace(/^@+/, '').slice(0, 60);
  }

  private pickFromSearch(results: any[], rawInput: string, leadName?: string): any | null {
    const input = norm(this.queryFromInput(rawInput));
    if (!input) return null;
    const exact = results.find((p) => norm(p.username) === input);
    if (exact) return exact;
    if (input.length >= 6) {
      const contains = results.find((p) => norm(p.username).includes(input) || (norm(p.username).length >= 6 && input.includes(norm(p.username))));
      if (contains) return contains;
    }
    const byName = results.find((p) => norm(p.full_name) === input);
    if (byName) return byName;
    if (input.length >= 8) {
      const typo = results.find((p) => editDistance(norm(p.username), input) <= 2);
      if (typo) return typo;
    }
    // Digitou o nome da loja/pessoa: aceita só se o nome do lead também bate e o perfil é do ramo.
    const name = norm(leadName || '');
    if (name.length >= 5) {
      const first = norm((leadName || '').split(/\s+/)[0]);
      const hit = results.find(
        (p) =>
          HAIR_WORDS.test(`${p.username} ${p.full_name} ${p.biography || ''}`) &&
          (norm(p.full_name).includes(first) || norm(p.username).includes(first)) &&
          (norm(p.full_name).includes(input) || norm(p.username).includes(input.slice(0, 8))),
      );
      if (hit) return hit;
    }
    return null;
  }

  private async search(query: string): Promise<any[]> {
    const { status, data } = await this.get('/v1/instagram/search/profiles', { query }, 30000);
    if (status !== 200 || !Array.isArray(data?.profiles)) return [];
    return data.profiles;
  }

  private async fetchFullProfile(
    handle: string,
  ): Promise<{ kind: 'ok' | 'private'; profile: IgProfile } | { kind: 'missing' } | { kind: 'blocked' }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { status, data } = await this.get('/v1/instagram/profile', { handle, cache_max_age: '1d' });
      const user = data?.data?.user;
      if (status === 200 && user?.id && data?.message !== 'Profile is private') return { kind: 'ok', profile: this.mapFull(user) };
      if (status === 200 && user && data?.message === 'Profile is private') return { kind: 'private', profile: this.mapFull(user) };
      if (status === 200 && data?.errorStatus === 404) return { kind: 'missing' };
      if (status === 403 || status === 404) return { kind: 'missing' };
      // 500 "IG is blocking us" / timeout: vale tentar de novo uma vez.
      if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
    }
    return { kind: 'blocked' };
  }

  private async fetchBasicProfile(userId: string): Promise<IgProfile | null> {
    const { status, data } = await this.get('/v1/instagram/basic-profile', { userId, cache_max_age: '1d' }, 30000);
    if (status !== 200 || !data?.username) return null;
    return {
      userId: String(data.pk || userId),
      username: data.username,
      fullName: data.full_name || '',
      biography: data.biography || '',
      category: data.category || null,
      isBusiness: !!data.is_business,
      isPrivate: !!data.is_private,
      isVerified: !!data.is_verified,
      followers: data.follower_count ?? null,
      following: data.following_count ?? null,
      mediaCount: data.media_count ?? null,
      externalUrl: data.external_url || null,
      links: (data.bio_links || []).map((l: any) => ({ url: l.url, type: l.link_type || 'external' })),
      businessPhone: data.public_phone_number || data.contact_phone_number || null,
      businessEmail: data.public_email || null,
      city: data.city_name || null,
      profilePicUrl: data.hd_profile_pic_url_info?.url || data.profile_pic_url || null,
      posts: [],
      reels: [],
      source: 'basic',
      resolvedBy: 'handle',
    };
  }

  private mapFull(u: any): IgProfile {
    const edges: any[] = u.edge_owner_to_timeline_media?.edges || [];
    const posts: IgPost[] = edges
      .map((e) => e.node)
      .filter((n) => n && (this.opts.includeCollabs || !n.owner?.username || n.owner.username === u.username))
      .map((n) => ({
        code: n.shortcode,
        kind: n.product_type === 'clips' ? 'reel' : n.__typename === 'XDTGraphSidecar' ? 'carrossel' : n.is_video ? 'video' : 'foto',
        caption: n.edge_media_to_caption?.edges?.[0]?.node?.text || '',
        takenAt: n.taken_at_timestamp || 0,
        likes: n.edge_media_preview_like?.count ?? n.edge_liked_by?.count ?? 0,
        comments: n.edge_media_to_comment?.count ?? n.comment_count ?? 0,
        plays: n.video_play_count ?? n.video_view_count ?? null,
        imageUrl: n.display_url || n.thumbnail_src || '',
      }));
    let city: string | null = null;
    try {
      const addr = typeof u.business_address_json === 'string' ? JSON.parse(u.business_address_json) : u.business_address_json;
      city = addr?.city_name || null;
    } catch {
      city = null;
    }
    return {
      userId: String(u.id),
      username: u.username,
      fullName: u.full_name || '',
      biography: u.biography || '',
      category: u.category_name || u.business_category_name || null,
      isBusiness: !!(u.is_business_account || u.is_professional_account),
      isPrivate: !!u.is_private,
      isVerified: !!u.is_verified,
      followers: u.edge_followed_by?.count ?? null,
      following: u.edge_follow?.count ?? null,
      mediaCount: u.edge_owner_to_timeline_media?.count ?? null,
      externalUrl: u.external_url || null,
      links: (u.bio_links || []).map((l: any) => ({ url: l.url, type: l.link_type || 'external' })),
      businessPhone: u.business_phone_number || null,
      businessEmail: u.business_email || null,
      city,
      profilePicUrl: u.profile_pic_url_hd || u.profile_pic_url || null,
      posts: posts.sort((a, b) => b.takenAt - a.takenAt),
      reels: [],
      source: 'profile',
      resolvedBy: 'handle',
    };
  }

  private async withReels(profile: IgProfile, resolvedBy: IgProfile['resolvedBy'], kind: 'ok' | 'private'): Promise<ResolveResult> {
    profile.resolvedBy = resolvedBy;
    if (kind === 'private') return { status: 'private', profile };
    profile.reels = await this.fetchReels(profile.userId, profile.username);
    return { status: 'ok', profile };
  }

  /** Reels mais recentes DELA (o endpoint também traz collabs de outros perfis). */
  private async fetchReels(userId: string, username: string): Promise<IgPost[]> {
    const { status, data } = await this.get('/v1/instagram/user/reels', { user_id: userId, trim: true }, 30000);
    if (status !== 200 || !Array.isArray(data?.items)) return [];
    return data.items
      .filter((r: any) => this.opts.includeCollabs || !r.user?.username || r.user.username === username)
      .slice(0, this.opts.reelsLimit ?? 8)
      .map((r: any) => ({
        code: r.code,
        kind: 'reel' as const,
        caption: r.caption?.text || '',
        takenAt: r.taken_at || 0,
        likes: r.like_count ?? 0,
        comments: r.comment_count ?? 0,
        plays: r.play_count ?? r.ig_play_count ?? null,
        imageUrl: r.display_uri || r.image_versions2?.candidates?.[0]?.url || '',
      }));
  }
}
