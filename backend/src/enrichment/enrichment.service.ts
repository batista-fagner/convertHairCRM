import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import axios from 'axios';
import { LeadsService } from '../leads/leads.service';
import { AiAnalysisService, HairProfileInsight } from '../ai-analysis/ai-analysis.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AvatarStorageService } from '../sdr/avatar-storage.service';
import { Lead, EnrichmentData } from '../common/entities/lead.entity';
import { IgPost, IgProfile, ScrapeCreatorsClient } from './scrape-creators.client';

/** Id fixo da nota no painel do card: reanalisar troca a nota em vez de empilhar. */
const NOTE_ID = 'ig-analysis';
const NOTE_AUTHOR = 'Análise do Instagram';
/** Lead mais velho que isso não é analisado sozinho (só pelo botão / Sofia). */
const AUTO_WINDOW_DAYS = 3;
const MAX_ATTEMPTS = 3;
const RUNNING_STALE_MS = 10 * 60_000;

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly scrape: ScrapeCreatorsClient;
  // Stories (fetchInstagramStories) seguem no RapidAPI — só o follow-up de stories usa.
  private readonly rapidapiKey: string;
  private readonly rapidapiHost: string;
  private readonly sdrUazapiBaseUrl: string;
  private readonly sdrUazapiToken: string;
  private scanning = false;

  constructor(
    private config: ConfigService,
    private leadsService: LeadsService,
    private aiAnalysisService: AiAnalysisService,
    private realtime: RealtimeGateway,
    @InjectRepository(Lead) private leadsRepo: Repository<Lead>,
    private avatarStorage: AvatarStorageService,
  ) {
    this.scrape = new ScrapeCreatorsClient(config.get('SCRAPECREATORS_API_KEY') || '');
    this.rapidapiKey = config.get('RAPIDAPI_KEY') || '';
    this.rapidapiHost = config.get('RAPIDAPI_HOST') || 'instagram120.p.rapidapi.com';
    this.sdrUazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || '';
    this.sdrUazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
  }

  /**
   * Varre os leads recentes que têm Instagram e ainda não foram analisados (ou
   * trocaram o @). Cobre todo canal — quiz, Sofia, formulário, edição no card —
   * sem cada um precisar chamar o enriquecimento. Poucos por vez: cada análise
   * leva ~20-30s (Scrape Creators + IA).
   */
  @Cron('*/2 * * * *')
  async enrichPending() {
    if (this.scanning || !this.scrape.configured) return;
    this.scanning = true;
    try {
      const since = new Date(Date.now() - AUTO_WINDOW_DAYS * 86_400_000);
      const leads = await this.leadsRepo.find({
        where: { createdAt: MoreThanOrEqual(since) } as any,
        select: ['id', 'instagram', 'semInstagram', 'enrichmentData'] as any,
        order: { createdAt: 'DESC' } as any,
        take: 200,
      });
      const due = leads.filter((l) => this.needsEnrichment(l)).slice(0, 3);
      for (const lead of due) {
        await this.enrichLeadFromInstagram(lead.id).catch((err) =>
          this.logger.warn(`[Enriquecimento] Lead ${lead.id}: ${err.message}`),
        );
      }
    } catch (err: any) {
      this.logger.error(`[Enriquecimento] Varredura falhou: ${err.message}`);
    } finally {
      this.scanning = false;
    }
  }

  private needsEnrichment(lead: Pick<Lead, 'instagram' | 'semInstagram' | 'enrichmentData'>, force = false): boolean {
    const input = (lead.instagram || '').trim();
    if (!input || lead.semInstagram) return false;
    const data = lead.enrichmentData;
    if (!data || data.input !== input) return true;
    const stale = !data.startedAt || Date.now() - new Date(data.startedAt).getTime() > RUNNING_STALE_MS;
    if (data.status === 'running') return stale && (data.attempts || 0) < MAX_ATTEMPTS;
    if (data.status === 'error') return stale && (data.attempts || 0) < MAX_ATTEMPTS;
    return force;
  }

  /**
   * Analisa o Instagram do lead (Scrape Creators + IA) e grava o resultado na
   * nota "Análise do Instagram" do card, em `aiInsight` (a Sofia lê nicho e
   * gargalo de lá) e em `enrichmentData`. Reserva o lead antes (status
   * running), então varredura, Sofia e botão do card nunca rodam em dobro.
   * `force` reanalisa mesmo quem já foi analisado (botão do card).
   */
  async enrichLeadFromInstagram(leadId: string, opts?: { force?: boolean }): Promise<Lead> {
    const lead = await this.leadsService.findById(leadId);
    const input = (lead.instagram || '').trim();
    if (!input) {
      this.logger.warn(`Lead ${leadId} não tem Instagram`);
      return lead;
    }
    if (!this.scrape.configured) throw new Error('SCRAPECREATORS_API_KEY não configurado');

    const previous = lead.enrichmentData ?? null;
    const sameInput = previous?.input === input;
    if (sameInput && previous?.status === 'running' && !this.needsEnrichment(lead)) return lead;
    if (!opts?.force && !this.needsEnrichment(lead)) return lead;

    const claim: EnrichmentData = {
      ...(sameInput ? previous : {}),
      status: 'running',
      input,
      attempts: (sameInput ? previous?.attempts || 0 : 0) + 1,
      startedAt: new Date().toISOString(),
    };
    const claimed = await this.leadsRepo
      .createQueryBuilder()
      .update(Lead)
      .set({ enrichmentData: claim as any })
      .where('id = :id', { id: leadId })
      .andWhere(previous ? 'enrichment_data = CAST(:prev AS jsonb)' : 'enrichment_data IS NULL', { prev: JSON.stringify(previous) })
      .execute();
    if (!claimed.affected) return lead; // outro processo pegou antes

    try {
      const result = await this.scrape.resolve(input, lead.name);

      if (result.status === 'not_found') {
        const candidates = result.candidates.length
          ? `\nPossíveis perfis (confira):\n${result.candidates.map((c) => `• @${c.username}${c.fullName ? ` — ${c.fullName}` : ''}${c.bio ? ` · "${c.bio}"` : ''}`).join('\n')}`
          : '';
        await this.finish(leadId, { ...claim, status: 'not_found', enrichedAt: new Date().toISOString() }, undefined,
          `📸 Não achei o Instagram "${input}" que ${this.firstName(lead.name)} informou.${candidates}`);
        this.logger.log(`[Enriquecimento] Lead ${leadId}: Instagram "${input}" não encontrado`);
        return this.leadsService.findById(leadId);
      }

      const profile = result.profile;
      const stats = this.stats(profile);
      const photo = await this.savePhoto(leadId, profile.profilePicUrl);
      const insight =
        result.status === 'private'
          ? null
          : await this.aiAnalysisService.analyzeHairProfile(
              this.profileText(profile, stats),
              {
                name: lead.name,
                quizAnswers: (lead.quizResponses || []).map((r) => `${r.question}: ${r.answer}`).join('\n') || undefined,
              },
              photo?.dataUrl,
            );

      const data: EnrichmentData = {
        ...claim,
        status: result.status,
        username: profile.username,
        userId: profile.userId,
        source: profile.source,
        resolvedBy: profile.resolvedBy,
        enrichedAt: new Date().toISOString(),
        profilePicUrl: photo?.publicUrl ?? null,
        followers: profile.followers ?? 0,
        engagement_rate: stats.engagementRate,
        content_type: profile.biography,
        recent_stories: [],
        enrichment_bonus: 0,
        posts: stats.own.slice(0, 6).map((p) => ({
          code: p.code,
          caption: p.caption,
          takenAt: p.takenAt,
          imageUrl: p.imageUrl,
          likeCount: p.likes,
          commentCount: p.comments,
        })),
      };
      await this.finish(leadId, data, insight ?? undefined, this.noteText(lead, profile, stats, insight, result.status === 'private'));
      this.logger.log(`[Enriquecimento] Lead ${leadId}: @${profile.username} analisado (${profile.source}, ${profile.resolvedBy})`);
      return this.leadsService.findById(leadId);
    } catch (err: any) {
      await this.leadsService.update(leadId, { enrichmentData: { ...claim, status: 'error', error: err.message } as any }).catch(() => {});
      throw err;
    }
  }

  private async finish(leadId: string, data: EnrichmentData, insight: HairProfileInsight | undefined, note: string) {
    await this.leadsService.update(leadId, { enrichmentData: data as any, ...(insight ? { aiInsight: insight } : {}) });
    const lead = await this.leadsService.upsertNoteEntry(leadId, { id: NOTE_ID, author: NOTE_AUTHOR, content: note.slice(0, 2000) });
    this.realtime.emitLeadUpdated(lead);
  }

  /**
   * Baixa a foto de perfil uma vez: vai pra IA (base64) e pro nosso storage —
   * o link do CDN do Instagram é assinado e para de abrir em poucos dias.
   */
  private async savePhoto(leadId: string, url: string | null): Promise<{ dataUrl: string; publicUrl: string | null } | null> {
    if (!url) return null;
    try {
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
      const contentType = String(res.headers['content-type'] || 'image/jpeg');
      const buffer = Buffer.from(res.data);
      const publicUrl = await this.avatarStorage
        .persistBuffer(`ig-${leadId}`, buffer, contentType)
        .catch((err) => {
          this.logger.warn(`[Enriquecimento] Foto do lead ${leadId} não foi pro storage: ${err.message}`);
          return null;
        });
      return { dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`, publicUrl };
    } catch (err: any) {
      this.logger.warn(`[Enriquecimento] Não baixei a foto de perfil do lead ${leadId}: ${err.message}`);
      return null;
    }
  }

  private firstName(name?: string) {
    return (name || '').split(' ')[0] || 'o lead';
  }

  private stats(profile: IgProfile) {
    const byCode = new Map<string, IgPost>();
    for (const p of [...profile.reels, ...profile.posts]) if (p.code && !byCode.has(p.code)) byCode.set(p.code, p);
    const own = [...byCode.values()].sort((a, b) => b.takenAt - a.takenAt);
    const now = Date.now() / 1000;
    const last = own[0]?.takenAt || 0;
    const reelPlays = own.filter((p) => p.kind === 'reel' && typeof p.plays === 'number').map((p) => p.plays as number);
    const avgInteractions = own.length ? own.reduce((s, p) => s + p.likes + p.comments, 0) / own.length : 0;
    return {
      own,
      daysSinceLast: last ? Math.floor((now - last) / 86_400) : null,
      last30: own.filter((p) => now - p.takenAt <= 30 * 86_400).length,
      avgReelPlays: reelPlays.length ? Math.round(reelPlays.reduce((a, b) => a + b, 0) / reelPlays.length) : null,
      engagementRate: profile.followers ? avgInteractions / profile.followers : 0,
    };
  }

  private fmt(n: number | null | undefined): string {
    if (n == null) return '?';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi`;
    if (n >= 10_000) return `${(n / 1000).toFixed(1).replace('.', ',').replace(',0', '')} mil`;
    return n.toLocaleString('pt-BR');
  }

  private linkKinds(profile: IgProfile): string[] {
    const urls = [...profile.links.map((l) => l.url), profile.externalUrl].filter(Boolean) as string[];
    const kinds = new Set<string>();
    for (const u of urls) {
      if (/wa\.me|whatsapp|api\.whatsapp/i.test(u)) kinds.add('WhatsApp');
      else if (/linktr\.ee|beacons|bio\.link|linkin\.bio/i.test(u)) kinds.add('Linktree');
      else if (/shopee|mercadolivre|nuvemshop|lojaintegrada|loja|shop|store/i.test(u)) kinds.add('loja online');
      else kinds.add('site');
    }
    return [...kinds];
  }

  /** Texto do perfil que vai pra IA: números, bio, links e legendas recentes. */
  private profileText(profile: IgProfile, stats: ReturnType<EnrichmentService['stats']>): string {
    const lines = [
      `@${profile.username} — ${profile.fullName}`,
      `Categoria: ${profile.category || '—'} · conta ${profile.isBusiness ? 'comercial' : 'pessoal'}`,
      `Seguidores: ${profile.followers ?? '?'} · seguindo: ${profile.following ?? '?'} · posts: ${profile.mediaCount ?? '?'}`,
      `Bio: ${profile.biography || '(vazia)'}`,
      `Links na bio: ${[...profile.links.map((l) => l.url), profile.externalUrl].filter(Boolean).join(' | ') || 'nenhum'}`,
      profile.city ? `Cidade: ${profile.city}` : '',
      `Último post: ${stats.daysSinceLast == null ? 'sem posts visíveis' : `há ${stats.daysSinceLast} dias`} · posts nos últimos 30 dias: ${stats.last30}`,
      stats.avgReelPlays != null ? `Média de views dos reels: ${stats.avgReelPlays}` : '',
      `Engajamento médio: ${(stats.engagementRate * 100).toFixed(2)}%`,
      '',
      'POSTS E REELS RECENTES (mais novo primeiro):',
      ...stats.own.slice(0, 10).map((p) => {
        const date = p.takenAt ? new Date(p.takenAt * 1000).toISOString().slice(0, 10) : '?';
        const plays = p.plays != null ? ` · ${p.plays} views` : '';
        return `- [${date}] ${p.kind} · ${p.likes} curtidas · ${p.comments} coment.${plays} — "${p.caption.replace(/\s+/g, ' ').slice(0, 220)}"`;
      }),
    ];
    return lines.filter((l) => l !== '').join('\n');
  }

  private noteText(
    lead: Lead,
    profile: IgProfile,
    stats: ReturnType<EnrichmentService['stats']>,
    insight: HairProfileInsight | null,
    isPrivate: boolean,
  ): string {
    const input = (lead.instagram || '').trim();
    const head = [`📸 @${profile.username}${profile.fullName ? ` — ${profile.fullName}` : ''}`];
    if (profile.resolvedBy !== 'handle') head.push(`⚠️ ${this.firstName(lead.name)} digitou "${input}" — achei este perfil ${profile.resolvedBy === 'search' ? 'pela busca' : 'pelo nome'}, confira se é o certo.`);

    const numbers = [`👥 ${this.fmt(profile.followers)} seguidores`, `${this.fmt(profile.mediaCount)} posts`];
    if (stats.daysSinceLast != null) numbers.push(stats.daysSinceLast === 0 ? 'postou hoje' : `último post há ${stats.daysSinceLast} dia${stats.daysSinceLast === 1 ? '' : 's'}`);
    if (stats.own.length) numbers.push(`${stats.last30} nos últimos 30 dias`);
    const lines = [...head, numbers.join(' · ')];

    const extra: string[] = [];
    if (stats.avgReelPlays != null) extra.push(`🎬 reels com ~${this.fmt(stats.avgReelPlays)} views`);
    if (stats.own.length && profile.followers) extra.push(`engajamento ${(stats.engagementRate * 100).toFixed(1).replace('.', ',')}%`);
    const links = this.linkKinds(profile);
    extra.push(links.length ? `🔗 bio com ${links.join(', ')}` : '🔗 sem link na bio');
    lines.push(extra.join(' · '));

    if (isPrivate) {
      lines.push('', '🔒 Perfil privado — só dá pra ver a bio.', profile.biography ? `Bio: ${profile.biography}` : 'Bio vazia.');
      return lines.join('\n');
    }
    if (profile.source === 'basic') lines.push('(Instagram bloqueou os posts agora — análise só pela bio e números.)');
    if (!insight) {
      lines.push('', profile.biography ? `Bio: ${profile.biography}` : 'Bio vazia.');
      return lines.join('\n');
    }

    const known = (v?: string | null) => (v && !/n[aã]o d[aá] pra saber/i.test(v) ? v : '');
    const where = known(insight.location) || profile.city;
    lines.push(
      '',
      `Quem é: ${insight.summary}`,
      `Faz: ${insight.niche}${known(insight.business_type) && insight.business_type !== 'outro' ? ` (${insight.business_type})` : ''}${where ? ` · 📍 ${where}` : ''}`,
      `Conteúdo: ${insight.content_pattern}`,
      `Ponto forte: ${insight.strengths}`,
      `Gargalo: ${insight.selling_angle}`,
    );
    if (insight.profile_photo) lines.push(`Foto de perfil: ${insight.profile_photo}`);
    if (insight.hooks.length) lines.push('', 'Ganchos pra abordagem:', ...insight.hooks.slice(0, 3).map((h) => `• ${h}`));
    return lines.join('\n');
  }

  async generateFollowupForLead(leadId: string): Promise<{ message: string; hasStories: boolean; storiesCount: number }> {
    const lead = await this.leadsService.findById(leadId);

    let stories: any[] = [];
    if (lead.instagram) {
      const handle = lead.instagram.replace(/^@/, '');
      stories = await this.fetchInstagramStories(handle);
    }

    const analyzedStories = stories.length > 0
      ? await this.aiAnalysisService.analyzeStoryImages(stories)
      : [];

    const message = await this.aiAnalysisService.generateFollowupMessage(lead, analyzedStories);
    return { message, hasStories: stories.length > 0, storiesCount: stories.length };
  }

  async sendFollowupMessage(leadId: string, message: string): Promise<{ sent: boolean }> {
    const lead = await this.leadsService.findById(leadId);

    if (!this.sdrUazapiToken) {
      throw new Error('SDR_UAZAPI_TOKEN não configurado — não é possível enviar o follow-up');
    }

    const phone = lead.phone.startsWith('55') ? lead.phone : `55${lead.phone}`;
    await axios.post(
      `${this.sdrUazapiBaseUrl}/send/text`,
      { number: phone, text: message },
      { headers: { token: this.sdrUazapiToken } },
    );

    const history = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    await this.leadsService.update(leadId, {
      aiContext: [...history, { role: 'assistant', content: message }],
      waLastMessageAt: new Date(),
    });

    this.logger.log(`Follow-up de stories enviado para ${phone} (lead: ${lead.name})`);
    return { sent: true };
  }

  private async fetchInstagramStories(handle: string): Promise<any[]> {
    try {
      const response = await axios.post(
        `https://${this.rapidapiHost}/api/instagram/stories`,
        { username: handle },
        {
          headers: {
            'x-rapidapi-key': this.rapidapiKey,
            'x-rapidapi-host': this.rapidapiHost,
            'Content-Type': 'application/json',
          },
        },
      );

      const items: any[] = response.data?.result || [];
      return items.slice(0, 5).map((story: any) => ({
        takenAt: story.taken_at,
        mediaType: story.media_type === 2 ? 'video' : 'foto',
        caption: story.caption?.text || '',
        imageUrl: story.image_versions2?.candidates?.[0]?.url || '',
      }));
    } catch (err: any) {
      this.logger.warn(`Stories indisponíveis para ${handle} (provavelmente conta privada): ${err.message}`);
      return [];
    }
  }

}
