import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { SocialLead, SocialLeadStatus, CommentIntent } from './social-lead.entity';
import { SocialSignal } from './social-signal.entity';
import { SettingsService } from '../settings/settings.service';
import { InstagramAutomationService } from '../instagram-automation/instagram-automation.service';
import { brt, brtAt, addDays } from '../common/brt.util';
import { JOB_COMMENT_DM, QUEUE_ENGINE_BULLMQ, SOCIAL_SELLING_QUEUE_NAME } from '../queue/queue.constants';
import {
  SOCIAL_TEMPLATE_VARIABLES,
  bestIntent,
  classifyComment,
  computeTemperature,
  normalizeUsername,
  renderSocialTemplate,
} from './social-selling.util';

export const SOCIAL_SELLING_CONFIG_KEY = 'social_selling_config';
export const SOCIAL_SELLING_EXT_STATUS_KEY = 'social_selling_ext_status';

export type SocialMode = 'desligado' | 'aprovar' | 'automatico';

export interface SocialSellingConfig {
  /** Conta de onde saem as DMs e cujos seguidores a extensão lê. */
  myProfile: string;
  comment: { mode: SocialMode; message: string; publicReply: string; intents: CommentIntent[]; dailyLimit: number };
  follow: { mode: SocialMode; message: string; dailyLimit: number; minDelaySec: number; maxDelaySec: number };
  scan: { enabled: boolean; intervalMin: number };
  /** Janela de envio (e de varredura), horário de Brasília. */
  startHour: number;
  endHour: number;
  /** A IA da inbox responde quando a pessoa responder a DM. */
  aiReplies: boolean;
}

export interface ExtensionStatus {
  lastSeenAt?: string;
  lastScanAt?: string;
  lastScanResult?: string;
  lastError?: string;
  lastErrorAt?: string;
}

const DEFAULT_CONFIG: SocialSellingConfig = {
  myProfile: 'converthair',
  comment: { mode: 'aprovar', message: '', publicReply: '', intents: ['quente'], dailyLimit: 40 },
  follow: { mode: 'aprovar', message: '', dailyLimit: 15, minDelaySec: 60, maxDelaySec: 150 },
  scan: { enabled: true, intervalMin: 180 },
  startHour: 9,
  endHour: 19,
  aiReplies: true,
};

/** Resposta privada a comentário só é aceita pelo Instagram até 7 dias depois. */
const PRIVATE_REPLY_WINDOW_MS = 7 * 86_400_000;
/** Mais que isso numa varredura só é quase certo erro de leitura (lista fora de ordem), não gente nova. */
export const MAX_FOLLOWERS_PER_SCAN = 40;
/** Reserva da extensão que não voltou (aba fechada, Chrome caiu) volta pra fila. */
const STALE_RESERVATION_MS = 15 * 60_000;

const MODES: SocialMode[] = ['desligado', 'aprovar', 'automatico'];
const INTENTS: CommentIntent[] = ['quente', 'morno', 'frio'];

@Injectable()
export class SocialSellingService implements OnModuleInit {
  private readonly logger = new Logger(SocialSellingService.name);

  constructor(
    @InjectRepository(SocialLead) private readonly leads: Repository<SocialLead>,
    @InjectRepository(SocialSignal) private readonly signals: Repository<SocialSignal>,
    private readonly settings: SettingsService,
    private readonly ig: InstagramAutomationService,
    private readonly config: ConfigService,
    @Optional() @InjectQueue(SOCIAL_SELLING_QUEUE_NAME) private readonly queue: Queue | null,
  ) {}

  onModuleInit() {
    this.ig.setSocialSellingHooks({
      onComment: (e) => this.onComment(e),
      claimReply: (p) => this.claimReply(p),
      linkConversation: (leadId, conversationId) => this.leads.update(leadId, { conversationId }).then(() => undefined),
      markReplied: (p) => this.markReplied(p),
    });
  }

  private get activeQueue(): Queue | null {
    if (this.config.get<string>('QUEUE_ENGINE') !== QUEUE_ENGINE_BULLMQ) return null;
    return this.queue ?? null;
  }

  // ─── Configuração ────────────────────────────────────────────────────────

  async getConfig(): Promise<SocialSellingConfig> {
    try {
      const saved = JSON.parse((await this.settings.get(SOCIAL_SELLING_CONFIG_KEY)) || '{}');
      return {
        ...DEFAULT_CONFIG,
        ...saved,
        comment: { ...DEFAULT_CONFIG.comment, ...(saved.comment || {}) },
        follow: { ...DEFAULT_CONFIG.follow, ...(saved.follow || {}) },
        scan: { ...DEFAULT_CONFIG.scan, ...(saved.scan || {}) },
      };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  async saveConfig(body: Partial<SocialSellingConfig>): Promise<SocialSellingConfig> {
    const cur = await this.getConfig();
    const next: SocialSellingConfig = {
      ...cur,
      ...body,
      comment: { ...cur.comment, ...(body.comment || {}) },
      follow: { ...cur.follow, ...(body.follow || {}) },
      scan: { ...cur.scan, ...(body.scan || {}) },
    };
    const int = (v: unknown, min: number, max: number, label: string) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) throw new BadRequestException(`${label} precisa ser entre ${min} e ${max}`);
      return n;
    };
    next.myProfile = normalizeUsername(next.myProfile) || DEFAULT_CONFIG.myProfile;
    if (!MODES.includes(next.comment.mode)) throw new BadRequestException('Modo inválido (comentário)');
    if (!MODES.includes(next.follow.mode)) throw new BadRequestException('Modo inválido (seguidor)');
    next.comment.intents = (next.comment.intents || []).filter((i) => INTENTS.includes(i));
    if (!next.comment.intents.length) next.comment.intents = ['quente'];
    next.comment.message = String(next.comment.message || '').slice(0, 1000);
    next.comment.publicReply = String(next.comment.publicReply || '').slice(0, 300);
    next.follow.message = String(next.follow.message || '').slice(0, 1000);
    next.comment.dailyLimit = int(next.comment.dailyLimit, 1, 200, 'Limite diário (comentário)');
    next.follow.dailyLimit = int(next.follow.dailyLimit, 1, 60, 'Limite diário (seguidor)');
    next.follow.minDelaySec = int(next.follow.minDelaySec, 30, 900, 'Intervalo mínimo');
    next.follow.maxDelaySec = int(next.follow.maxDelaySec, next.follow.minDelaySec, 1800, 'Intervalo máximo');
    next.scan.enabled = !!next.scan.enabled;
    next.scan.intervalMin = int(next.scan.intervalMin, 30, 1440, 'Intervalo da varredura (min)');
    next.startHour = int(next.startHour, 0, 23, 'Hora de início');
    next.endHour = int(next.endHour, 1, 24, 'Hora de fim');
    if (next.endHour <= next.startHour) throw new BadRequestException('O fim da janela precisa ser depois do início');
    next.aiReplies = !!next.aiReplies;
    await this.settings.set(SOCIAL_SELLING_CONFIG_KEY, JSON.stringify(next));
    return next;
  }

  private inWindow(cfg: SocialSellingConfig, now = new Date()): boolean {
    const { hour } = brt(now);
    return hour >= cfg.startHour && hour < cfg.endHour;
  }

  /** Quanto falta pra janela abrir (0 se já está aberta). */
  private msUntilWindow(cfg: SocialSellingConfig, now = new Date()): number {
    if (this.inWindow(cfg, now)) return 0;
    const { ymd, hour } = brt(now);
    const day = hour < cfg.startHour ? ymd : brt(addDays(now, 1)).ymd;
    return Math.max(0, brtAt(day, cfg.startHour).getTime() - now.getTime());
  }

  private startOfTodayBrt(now = new Date()): Date {
    return brtAt(brt(now).ymd, 0);
  }

  private async sentToday(channel: 'comentario' | 'extensao'): Promise<number> {
    return this.leads
      .createQueryBuilder('l')
      .where('l.dm_channel = :channel', { channel })
      .andWhere('l.dm_sent_at >= :since', { since: this.startOfTodayBrt() })
      .getCount();
  }

  // ─── Tela do CRM ─────────────────────────────────────────────────────────

  async overview() {
    const [config, byStatus, byTemp, commentToday, followToday, ext] = await Promise.all([
      this.getConfig(),
      this.leads.createQueryBuilder('l').select('l.status', 'key').addSelect('COUNT(*)::int', 'n').groupBy('l.status').getRawMany(),
      this.leads
        .createQueryBuilder('l')
        .select('l.temperature', 'key')
        .addSelect('COUNT(*)::int', 'n')
        .where('l.status NOT IN (:...gone)', { gone: ['descartado', 'ignorado'] })
        .groupBy('l.temperature')
        .getRawMany(),
      this.sentToday('comentario'),
      this.sentToday('extensao'),
      this.getExtensionStatus(),
    ]);
    const toMap = (rows: { key: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.key, Number(r.n)]));
    return {
      config,
      variables: SOCIAL_TEMPLATE_VARIABLES,
      byStatus: toMap(byStatus),
      byTemperature: toMap(byTemp),
      sentToday: { comentario: commentToday, extensao: followToday },
      inWindow: this.inWindow(config),
      extension: ext,
    };
  }

  async list(q: { temperature?: string; status?: string; signal?: string; search?: string; page?: number; limit?: number }) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const qb = this.leads.createQueryBuilder('l');
    if (q.temperature) qb.andWhere('l.temperature = :t', { t: q.temperature });
    if (q.status === 'pendentes') qb.andWhere("l.status = 'novo'");
    else if (q.status) qb.andWhere('l.status = :s', { s: q.status });
    else qb.andWhere("l.status <> 'descartado'");
    if (q.signal === 'follow') qb.andWhere('l.followed_at IS NOT NULL');
    if (q.signal === 'comment') qb.andWhere('l.comment_count > 0');
    if (q.search) qb.andWhere('(l.username ILIKE :q OR l.full_name ILIKE :q)', { q: `%${normalizeUsername(q.search)}%` });
    const [data, total] = await qb
      .orderBy('l.score', 'DESC')
      .addOrderBy('l.last_signal_at', 'DESC', 'NULLS LAST')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { data, total, page, totalPages: Math.ceil(total / limit) || 1 };
  }

  async signalsOf(id: string) {
    return this.signals.find({ where: { socialLeadId: id }, order: { createdAt: 'DESC' }, take: 50 });
  }

  async preview(body: { template?: string; kind?: 'comment' | 'follow'; leadId?: string }) {
    const cfg = await this.getConfig();
    const template = body.template ?? (body.kind === 'follow' ? cfg.follow.message : cfg.comment.message);
    const lead = body.leadId ? await this.leads.findOneBy({ id: body.leadId }) : null;
    const samples = lead
      ? [{ fullName: lead.fullName, comment: lead.lastCommentText }]
      : [
          { fullName: 'Juliana Santana | Mega Hair', comment: 'Quero saber o valor!' },
          { fullName: 'stillo hair', comment: 'Como funciona?' },
          { fullName: null, comment: 'eu' },
        ];
    return samples.map((s) => ({ ...s, text: renderSocialTemplate(template, s) }));
  }

  /** Aprovar: comentário recente sai na hora pela resposta privada; seguidor entra na fila da extensão. */
  async approve(id: string) {
    const lead = await this.leads.findOneBy({ id });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (lead.dmSentAt) throw new BadRequestException('Essa pessoa já recebeu a DM');
    const cfg = await this.getConfig();

    if (this.canPrivateReply(lead)) {
      if (!cfg.comment.message.trim()) throw new BadRequestException('Escreva a mensagem de comentário antes de aprovar');
      await this.leads.update(id, { status: 'na_fila', dmChannel: 'comentario', skipReason: null, dmError: null });
      return this.processCommentDm(id, { manual: true });
    }
    if (!lead.followedAt) throw new BadRequestException('O comentário tem mais de 7 dias: o Instagram não deixa mais responder por DM');
    if (!cfg.follow.message.trim()) throw new BadRequestException('Escreva a mensagem de boas-vindas antes de aprovar');
    await this.leads.update(id, { status: 'na_fila', dmChannel: 'extensao', skipReason: null, dmError: null, reservedAt: null });
    return this.leads.findOneBy({ id });
  }

  async discard(id: string) {
    const res = await this.leads.update(id, { status: 'descartado', reservedAt: null });
    if (!res.affected) throw new NotFoundException('Lead não encontrado');
    return this.leads.findOneBy({ id });
  }

  async restore(id: string) {
    const lead = await this.leads.findOneBy({ id });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    const status: SocialLeadStatus = lead.repliedAt ? 'respondeu' : lead.dmSentAt ? 'dm_enviada' : 'novo';
    await this.leads.update(id, { status, skipReason: null, reservedAt: null });
    return this.leads.findOneBy({ id });
  }

  private canPrivateReply(lead: SocialLead, now = new Date()): boolean {
    return !!lead.lastCommentId && !!lead.lastCommentAt && now.getTime() - new Date(lead.lastCommentAt).getTime() < PRIVATE_REPLY_WINDOW_MS - 3_600_000;
  }

  // ─── Sinais ──────────────────────────────────────────────────────────────

  /** Já existe relação com essa pessoa? (não abordar de novo) */
  private async existingRelationship(username: string, igUserId?: string | null): Promise<string | null> {
    const lead = await this.leads.manager.query(
      `SELECT 1 FROM leads WHERE lower(regexp_replace(trim(instagram), '^@', '')) = $1 LIMIT 1`,
      [username],
    );
    if (lead.length) return 'já é lead no CRM';
    const conv = await this.leads.manager.query(
      `SELECT 1 FROM ig_conversations WHERE lower(ig_username) = $1 OR ($2::varchar IS NOT NULL AND sender_ig_id = $2) LIMIT 1`,
      [username, igUserId ?? null],
    );
    if (conv.length) return 'já conversa na inbox';
    return null;
  }

  private async upsertLead(username: string, patch: Partial<SocialLead> = {}): Promise<SocialLead> {
    await this.leads
      .createQueryBuilder()
      .insert()
      .values({ username, ...patch })
      .orIgnore()
      .execute();
    const lead = await this.leads.findOneByOrFail({ username });
    return lead;
  }

  private async recompute(lead: SocialLead, patch: Partial<SocialLead>): Promise<SocialLead> {
    const merged = { ...lead, ...patch };
    const { temperature, score } = computeTemperature(merged);
    await this.leads.update(lead.id, { ...patch, temperature, score });
    return { ...merged, temperature, score } as SocialLead;
  }

  /** Webhook de comentário (posts e anúncios da converthair). */
  async onComment(e: { commentId: string; mediaId: string; senderIgId?: string; username?: string; text: string; matchedAutomation: boolean }) {
    const username = normalizeUsername(e.username);
    if (!username || !e.commentId) return;
    const cfg = await this.getConfig();
    if (username === cfg.myProfile) return;

    const intent = classifyComment(e.text);
    let lead = await this.upsertLead(username, { igUserId: e.senderIgId ?? null });

    try {
      await this.signals.insert({ socialLeadId: lead.id, type: 'comment', commentId: e.commentId, commentText: e.text, intent, mediaId: e.mediaId });
    } catch (err: any) {
      if (err?.code === '23505') return; // retry do webhook
      throw err;
    }

    const now = new Date();
    lead = await this.recompute(lead, {
      igUserId: lead.igUserId || e.senderIgId || null,
      commentCount: lead.commentCount + 1,
      bestCommentIntent: bestIntent(lead.bestCommentIntent, intent),
      lastCommentAt: now,
      lastCommentText: e.text,
      lastCommentId: e.commentId,
      lastCommentMediaId: e.mediaId,
      lastSignalAt: now,
    });

    // Falhou antes (ex.: comentário apagado) e comentou de novo: tenta outra vez.
    if (lead.status === 'falhou' && !lead.dmSentAt) {
      await this.leads.update(lead.id, { status: 'novo', dmError: null });
      lead = { ...lead, status: 'novo', dmError: null };
    }
    if (lead.status !== 'novo' || lead.dmSentAt) return;

    const skip = e.matchedAutomation ? 'a automação do post já respondeu' : await this.existingRelationship(username, lead.igUserId);
    if (skip) {
      await this.leads.update(lead.id, { status: 'ignorado', skipReason: skip });
      return;
    }

    if (
      cfg.comment.mode === 'automatico' &&
      cfg.comment.message.trim() &&
      cfg.comment.intents.includes(intent) &&
      (await this.sentToday('comentario')) < cfg.comment.dailyLimit
    ) {
      await this.leads.update(lead.id, { status: 'na_fila', dmChannel: 'comentario' });
      // Resposta privada é API oficial: sai na hora (só espera se estiver fora do horário).
      await this.scheduleCommentDm(lead.id, this.msUntilWindow(cfg));
    }
  }

  private async scheduleCommentDm(leadId: string, delayMs: number) {
    const queue = this.activeQueue;
    if (queue) {
      await queue.add(JOB_COMMENT_DM, { leadId }, {
        jobId: `comment-dm_${leadId}_${Date.now()}`,
        delay: Math.max(0, delayMs),
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      });
      return;
    }
    // Sem fila (modo legado): manda no próprio processo. Se o backend reiniciar
    // antes, o lead fica "na fila" e dá pra aprovar de novo pela tela.
    setTimeout(() => this.processCommentDm(leadId).catch((err) => this.logger.error(`DM de comentário: ${err.message}`)), Math.min(delayMs, 2 ** 31 - 1));
  }

  /** Envia a DM de comentário (job da fila ou aprovação manual). */
  async processCommentDm(leadId: string, opts: { manual?: boolean } = {}) {
    const lead = await this.leads.findOneBy({ id: leadId });
    if (!lead || lead.status !== 'na_fila' || lead.dmSentAt || lead.dmChannel !== 'comentario') return lead;
    const cfg = await this.getConfig();

    if (!opts.manual) {
      if (cfg.comment.mode !== 'automatico') {
        await this.leads.update(leadId, { status: 'novo' });
        return lead;
      }
      const wait = this.msUntilWindow(cfg);
      if (wait > 0) {
        await this.scheduleCommentDm(leadId, wait + Math.floor(Math.random() * 20 * 60_000));
        return lead;
      }
      if ((await this.sentToday('comentario')) >= cfg.comment.dailyLimit) {
        // Limite do dia batido: tenta de novo quando a janela de amanhã abrir.
        const tomorrow = brtAt(brt(addDays(new Date(), 1)).ymd, cfg.startHour).getTime() - Date.now();
        await this.scheduleCommentDm(leadId, tomorrow + Math.floor(Math.random() * 30 * 60_000));
        return lead;
      }
    }

    if (!this.canPrivateReply(lead)) {
      await this.leads.update(leadId, { status: 'falhou', dmError: 'comentário com mais de 7 dias' });
      return this.leads.findOneBy({ id: leadId });
    }
    const message = renderSocialTemplate(cfg.comment.message, { fullName: lead.fullName, comment: lead.lastCommentText });
    if (!message) {
      await this.leads.update(leadId, { status: 'novo', dmError: 'mensagem vazia' });
      return this.leads.findOneBy({ id: leadId });
    }

    // Resposta pública no comentário ("te enviei uma DM 😉"): sai só depois da DM
    // dar certo. Sem nome (comentário não traz) e sem {comentario} — fica genérica.
    const publicReply = cfg.comment.publicReply.trim()
      ? renderSocialTemplate(cfg.comment.publicReply, { fullName: lead.fullName })
      : undefined;

    const res = await this.ig.sendSocialCommentDm({
      commentId: lead.lastCommentId!,
      senderIgId: lead.igUserId ?? undefined,
      username: lead.username,
      mediaId: lead.lastCommentMediaId ?? undefined,
      commentText: lead.lastCommentText ?? '',
      message,
      publicReply,
      aiReplies: cfg.aiReplies,
    });
    if (res.ok) {
      await this.leads.update(leadId, {
        status: 'dm_enviada',
        dmMessage: message,
        dmSentAt: new Date(),
        dmError: null,
        conversationId: res.conversationId ?? lead.conversationId ?? null,
      });
      this.logger.log(`Social selling: DM de comentário enviada para @${lead.username}`);
    } else {
      await this.leads.update(leadId, { status: 'falhou', dmError: (res.error || 'erro ao enviar').slice(0, 250) });
    }
    return this.leads.findOneBy({ id: leadId });
  }

  // ─── Extensão ────────────────────────────────────────────────────────────

  async extensionConfig() {
    const cfg = await this.getConfig();
    return {
      myProfile: cfg.myProfile,
      scan: cfg.scan,
      startHour: cfg.startHour,
      endHour: cfg.endHour,
      inWindow: this.inWindow(cfg),
      followMode: cfg.follow.mode,
      minDelaySec: cfg.follow.minDelaySec,
      maxDelaySec: cfg.follow.maxDelaySec,
      maxFollowersPerScan: MAX_FOLLOWERS_PER_SCAN,
    };
  }

  /** Novos seguidores achados pela extensão (diferença contra a lista-base dela). */
  async registerFollowers(body: { usernames?: string[]; fullNames?: Record<string, string> }) {
    const cfg = await this.getConfig();
    const list = [...new Set((body.usernames || []).map(normalizeUsername).filter((u) => u && u !== cfg.myProfile))];
    if (list.length > MAX_FOLLOWERS_PER_SCAN) {
      throw new BadRequestException(`${list.length} seguidores novos de uma vez é suspeito (limite ${MAX_FOLLOWERS_PER_SCAN}) — nada foi registrado`);
    }
    const now = new Date();
    let created = 0;
    let queued = 0;
    let skipped = 0;
    for (const username of list) {
      let lead = await this.upsertLead(username);
      if (lead.followedAt) continue; // já contado
      created++;
      await this.signals.insert({ socialLeadId: lead.id, type: 'follow' });
      lead = await this.recompute(lead, { followedAt: now, lastSignalAt: now, fullName: lead.fullName || body.fullNames?.[username] || null });
      if (lead.status !== 'novo' || lead.dmSentAt) continue;
      const skip = await this.existingRelationship(username, lead.igUserId);
      if (skip) {
        skipped++;
        await this.leads.update(lead.id, { status: 'ignorado', skipReason: skip });
        continue;
      }
      if (cfg.follow.mode === 'automatico' && cfg.follow.message.trim()) {
        queued++;
        await this.leads.update(lead.id, { status: 'na_fila', dmChannel: 'extensao' });
      }
    }
    return { received: list.length, created, queued, skipped };
  }

  /** Próxima DM pra extensão mandar — reserva 1 por vez. */
  async nextDm(): Promise<{ username: string; message: string; leadId: string } | { wait: string }> {
    const cfg = await this.getConfig();
    if (cfg.follow.mode === 'desligado') return { wait: 'DM de seguidor está desligada no CRM' };
    if (!cfg.follow.message.trim()) return { wait: 'mensagem de boas-vindas ainda não escrita no CRM' };
    if (!this.inWindow(cfg)) return { wait: `fora do horário (${cfg.startHour}h às ${cfg.endHour}h)` };
    if ((await this.sentToday('extensao')) >= cfg.follow.dailyLimit) return { wait: `limite diário de ${cfg.follow.dailyLimit} DMs atingido` };

    await this.leads.manager.query(
      `UPDATE social_leads SET status = 'na_fila', reserved_at = NULL
        WHERE status = 'enviando' AND reserved_at < $1`,
      [new Date(Date.now() - STALE_RESERVATION_MS)],
    );
    const rows: { id: string }[] = await this.leads.manager.query(
      `UPDATE social_leads SET status = 'enviando', reserved_at = now()
        WHERE id = (
          SELECT id FROM social_leads
           WHERE status = 'na_fila' AND dm_channel = 'extensao' AND dm_sent_at IS NULL
           ORDER BY score DESC, followed_at ASC NULLS LAST
           LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id`,
    );
    const id = rows?.[0]?.id ?? (Array.isArray(rows?.[0]) ? (rows as any)[0][0]?.id : undefined);
    if (!id) return { wait: 'fila vazia' };
    const lead = await this.leads.findOneByOrFail({ id });
    const message = renderSocialTemplate(cfg.follow.message, { fullName: lead.fullName, comment: lead.lastCommentText }, { keepName: true });
    return { leadId: lead.id, username: lead.username, message };
  }

  async dmResult(body: { username?: string; ok?: boolean; message?: string; fullName?: string; error?: string }) {
    const username = normalizeUsername(body.username);
    const lead = username ? await this.leads.findOneBy({ username }) : null;
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (body.ok) {
      await this.leads.update(lead.id, {
        status: 'dm_enviada',
        dmChannel: 'extensao',
        dmSentAt: new Date(),
        dmMessage: String(body.message || '').slice(0, 2000) || lead.dmMessage,
        fullName: body.fullName || lead.fullName,
        dmError: null,
        reservedAt: null,
      });
    } else {
      await this.leads.update(lead.id, {
        status: 'falhou',
        dmError: String(body.error || 'falha no envio pela extensão').slice(0, 250),
        fullName: body.fullName || lead.fullName,
        reservedAt: null,
      });
    }
    return { ok: true };
  }

  async getExtensionStatus(): Promise<ExtensionStatus> {
    try {
      return JSON.parse((await this.settings.get(SOCIAL_SELLING_EXT_STATUS_KEY)) || '{}');
    } catch {
      return {};
    }
  }

  async reportExtensionStatus(body: { event?: string; detail?: string }) {
    const cur = await this.getExtensionStatus();
    const now = new Date().toISOString();
    const next: ExtensionStatus = { ...cur, lastSeenAt: now };
    const detail = String(body.detail || '').slice(0, 300);
    if (body.event === 'scan') {
      next.lastScanAt = now;
      next.lastScanResult = detail;
    }
    if (body.event === 'error') {
      next.lastError = detail;
      next.lastErrorAt = now;
    }
    await this.settings.set(SOCIAL_SELLING_EXT_STATUS_KEY, JSON.stringify(next));
    return { ok: true };
  }

  // ─── Respostas (chamado pela inbox do Instagram) ─────────────────────────

  /**
   * Primeira DM de alguém sem conversa na inbox: se é um seguidor que recebeu
   * a boas-vindas pela extensão, devolve a mensagem que ele recebeu pra IA
   * responder sabendo do contexto.
   */
  private async claimReply(p: { senderIgId: string; username?: string | null }) {
    const username = normalizeUsername(p.username);
    if (!username && !p.senderIgId) return null;
    const lead = await this.leads
      .createQueryBuilder('l')
      .where('l.dm_sent_at IS NOT NULL')
      .andWhere('(l.username = :u OR l.ig_user_id = :id)', { u: username || '-', id: p.senderIgId })
      .getOne();
    if (!lead) return null;
    await this.recompute(lead, {
      igUserId: lead.igUserId || p.senderIgId,
      repliedAt: lead.repliedAt || new Date(),
      status: 'respondeu',
    });
    const cfg = await this.getConfig();
    return { leadId: lead.id, opening: lead.dmMessage ?? null, aiReplies: cfg.aiReplies };
  }

  private async markReplied(p: { senderIgId: string; username?: string | null }) {
    const username = normalizeUsername(p.username) || '-';
    await this.leads.manager.query(
      `UPDATE social_leads
          SET replied_at = now(), status = 'respondeu', temperature = 'muito_quente', score = 4, updated_at = now()
        WHERE dm_sent_at IS NOT NULL AND replied_at IS NULL
          AND (ig_user_id = $1 OR username = $2)`,
      [p.senderIgId, username],
    );
  }
}
