import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ColdCallLead } from '../common/entities/coldcall-lead.entity';
import { SettingsService } from '../settings/settings.service';

/**
 * Disparo de WhatsApp em lote pros prospects do Cold Call, pelo número do
 * próprio sócio (instância uazapi separada, token salvo em settings).
 *
 * Tudo que segura o ritmo fica no banco (fila em coldcall_leads.outreach_*,
 * estado em settings.coldcall_outreach), então um deploy no meio do lote não
 * perde nem repete nada: o cron só continua de onde parou.
 *
 * Cuidados contra bloqueio:
 * - intervalo escolhido pelo usuário com variação aleatória (70%–140%), nunca cravado;
 * - "digitando..." proporcional ao tamanho do texto antes de cada envio;
 * - pausa longa a cada LONG_PAUSE_EVERY envios;
 * - só envia na janela de horário comercial (seg–sáb) e até o limite diário;
 * - confere se o número tem WhatsApp antes (fixo/sem WhatsApp é pulado, sem gastar intervalo);
 * - variações {a|b|c} no texto, pra mensagem não sair idêntica pra todo mundo;
 * - 3 falhas seguidas ou instância desconectada → pausa o lote sozinho;
 * - quem já entrou num lote nunca entra de novo.
 */

export const OUTREACH_TOKEN_KEY = 'coldcall_uazapi_token';
const OUTREACH_STATE_KEY = 'coldcall_outreach';
const OUTREACH_LOCK_KEY = 'coldcall_outreach_lock';

const LONG_PAUSE_EVERY = 10;
const MAX_CONSECUTIVE_FAILS = 3;

export const DEFAULT_OUTREACH_TEMPLATE =
  '{saudacao}!\n\nQuem cuida da parte comercial ou o responsável pelas vendas aí na {empresa}? Preciso tirar uma dúvida rápida com ele.';

export interface OutreachState {
  template: string;
  delaySec: number;
  dailyLimit: number;
  startHour: number;
  endHour: number;
  running: boolean;
  listName: string | null;
  nextAt: string | null;
  sentInRun: number;
  consecutiveFails: number;
  pausedReason: string | null;
}

const DEFAULT_STATE: OutreachState = {
  template: DEFAULT_OUTREACH_TEMPLATE,
  delaySec: 60,
  dailyLimit: 50,
  startHour: 8,
  endHour: 18,
  running: false,
  listName: null,
  nextAt: null,
  sentInRun: 0,
  consecutiveFails: 0,
  pausedReason: null,
};

const TZ = 'America/Sao_Paulo';

function brtParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {} as Record<string, string>);
  return { hour: Number(parts.hour), weekday: parts.weekday, date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Meia-noite de hoje em Brasília, como Date (UTC). */
function startOfTodayBrt(): Date {
  const { date } = brtParts();
  return new Date(`${date}T00:00:00-03:00`);
}

export function greetingNow(d = new Date()): string {
  const { hour } = brtParts(d);
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** "AGRONORTE LTDA" → "Agronorte"; "MJ Center (Peças e Irrigação)" → "MJ Center". */
export function cleanCompanyName(name: string): string {
  let n = String(name || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const suffix = /[\s,.-]+(ltda|me|epp|eireli|s\.?\/?a\.?)\.?$/i;
  while (suffix.test(n)) n = n.replace(suffix, '').trim();
  if (n && n === n.toUpperCase() && /[A-ZÀ-Ú]{4,}/.test(n)) {
    n = n.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, sp, ch) => sp + ch.toUpperCase());
  }
  return n || String(name || '').trim();
}

function firstSegment(segment?: string | null): string {
  // "Agropecuária / Insumos e Rações" → "agropecuária"
  return String(segment || '').split(/[\/,]/)[0].trim().toLowerCase();
}

export const TEMPLATE_VARIABLES = ['saudacao', 'empresa', 'cidade', 'estado', 'segmento'] as const;

/** Troca {variavel} e sorteia {opção a|opção b}. Variável desconhecida fica como está. */
export function renderTemplate(template: string, p: Partial<ColdCallLead>, now = new Date()): string {
  const values: Record<string, string> = {
    saudacao: greetingNow(now),
    empresa: cleanCompanyName(p.companyName || ''),
    cidade: p.city || '',
    estado: p.state || '',
    segmento: firstSegment(p.segment),
  };
  return template
    .replace(/\{([^{}]+)\}/g, (match, inner: string) => {
      if (inner.includes('|')) {
        const options = inner.split('|');
        return options[Math.floor(Math.random() * options.length)];
      }
      const key = inner.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return key in values ? values[key] : match;
    })
    .trim();
}

@Injectable()
export class ColdCallOutreachService {
  private readonly logger = new Logger(ColdCallOutreachService.name);
  private ticking = false;

  constructor(
    @InjectRepository(ColdCallLead) private readonly repo: Repository<ColdCallLead>,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.config.get('COLDCALL_UAZAPI_BASE_URL') || this.config.get('SDR_UAZAPI_BASE_URL') || this.config.get('UAZAPI_BASE_URL') || '';
  }

  private async token(): Promise<string> {
    return (await this.settings.get(OUTREACH_TOKEN_KEY))?.trim() || '';
  }

  async getState(): Promise<OutreachState> {
    try {
      return { ...DEFAULT_STATE, ...JSON.parse((await this.settings.get(OUTREACH_STATE_KEY)) || '{}') };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private async saveState(patch: Partial<OutreachState>): Promise<OutreachState> {
    const next = { ...(await this.getState()), ...patch };
    await this.settings.set(OUTREACH_STATE_KEY, JSON.stringify(next));
    return next;
  }

  private async uazapi(path: string, method: 'GET' | 'POST', body?: object): Promise<any> {
    const token = await this.token();
    if (!token || !this.baseUrl) throw new Error('Número não conectado (falta o token da instância)');
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', token },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`), { status: res.status });
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /** Status da instância: conectado? qual número? Nunca lança. */
  async connection(): Promise<{ hasToken: boolean; connected: boolean; number: string | null; name: string | null; error?: string }> {
    const token = await this.token();
    if (!token) return { hasToken: false, connected: false, number: null, name: null };
    try {
      const d = await this.uazapi('/instance/status', 'GET');
      const inst = d?.instance || d || {};
      const status = String(inst.status || d?.status?.connected || '').toLowerCase();
      const connected = status === 'connected' || d?.status?.connected === true || d?.connected === true;
      const jid = String(d?.status?.jid || inst.owner || inst.jid || '');
      return {
        hasToken: true,
        connected,
        number: jid ? jid.split('@')[0].split(':')[0] : null,
        name: inst.profileName || inst.name || null,
      };
    } catch (e) {
      return { hasToken: true, connected: false, number: null, name: null, error: e.message };
    }
  }

  async setToken(token: string) {
    await this.settings.set(OUTREACH_TOKEN_KEY, String(token || '').trim());
    return this.connection();
  }

  async saveSettings(body: Partial<Pick<OutreachState, 'template' | 'delaySec' | 'dailyLimit' | 'startHour' | 'endHour'>>) {
    const patch: Partial<OutreachState> = {};
    if (typeof body.template === 'string') {
      if (!body.template.trim()) throw new BadRequestException('A mensagem não pode ficar vazia');
      patch.template = body.template.slice(0, 2000);
    }
    if (body.delaySec != null) patch.delaySec = Math.min(600, Math.max(20, Math.round(Number(body.delaySec) || 60)));
    if (body.dailyLimit != null) patch.dailyLimit = Math.min(300, Math.max(1, Math.round(Number(body.dailyLimit) || 50)));
    if (body.startHour != null) patch.startHour = Math.min(23, Math.max(0, Math.round(Number(body.startHour))));
    if (body.endHour != null) patch.endHour = Math.min(24, Math.max(1, Math.round(Number(body.endHour))));
    const current = await this.getState();
    if ((patch.startHour ?? current.startHour) >= (patch.endHour ?? current.endHour)) throw new BadRequestException('O horário de início precisa ser antes do fim');
    return this.saveState(patch);
  }

  private eligibleWhere(listName?: string | null) {
    return {
      outreachStatus: IsNull(),
      kanbanStage: 'novo',
      ...(listName ? { listName } : {}),
    };
  }

  async sentToday(): Promise<number> {
    return this.repo
      .createQueryBuilder('l')
      .where('l.outreach_status = :s', { s: 'sent' })
      .andWhere('l.outreach_sent_at >= :d', { d: startOfTodayBrt() })
      .getCount();
  }

  /** Painel: estado do lote, contadores e últimos envios. */
  async overview(listName?: string | null) {
    const [state, connection, sentToday] = await Promise.all([this.getState(), this.connection(), this.sentToday()]);
    const counts = await this.repo
      .createQueryBuilder('l')
      .select('l.outreach_status', 'status')
      .addSelect('count(*)', 'n')
      .where('l.outreach_status IS NOT NULL')
      .andWhere(listName ? 'l.list_name = :listName' : '1=1', { listName })
      .groupBy('l.outreach_status')
      .getRawMany();
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, Number(c.n)]));
    const eligible = await this.repo
      .createQueryBuilder('l')
      .where('l.outreach_status IS NULL')
      .andWhere("l.kanban_stage = 'novo'")
      .andWhere('l.phone IS NOT NULL')
      .andWhere(listName ? 'l.list_name = :listName' : '1=1', { listName })
      .getCount();
    const recent = await this.repo.find({
      where: { outreachStatus: In(['sent', 'failed', 'skipped', 'sending']), ...(listName ? { listName } : {}) },
      order: { updatedAt: 'DESC' },
      take: 15,
      select: ['id', 'companyName', 'city', 'phone', 'outreachStatus', 'outreachSentAt', 'outreachError', 'updatedAt'],
    });
    return {
      state,
      connection,
      sentToday,
      eligible,
      queued: (byStatus.queued || 0) + (byStatus.sending || 0),
      sent: byStatus.sent || 0,
      failed: byStatus.failed || 0,
      skipped: byStatus.skipped || 0,
      inWindow: this.inWindow(state),
      recent,
    };
  }

  /** Prévia da mensagem pros primeiros prospects que entrariam no lote. */
  async preview(template: string, listName?: string | null) {
    const sample = await this.repo.find({
      where: this.eligibleWhere(listName),
      order: { priority: 'ASC', createdAt: 'ASC' },
      take: 3,
    });
    return sample.map((p) => ({ companyName: p.companyName, text: renderTemplate(template || DEFAULT_OUTREACH_TEMPLATE, p) }));
  }

  async start(body: { listName?: string | null; size: number; template?: string; delaySec?: number }) {
    const state = await this.getState();
    if (state.running) throw new BadRequestException('Já existe um lote rodando. Pause ou cancele antes.');
    const conn = await this.connection();
    if (!conn.connected) throw new BadRequestException('O número não está conectado. Confira o token da instância.');
    const size = Math.min(200, Math.max(1, Math.round(Number(body.size) || 0)));
    if (body.template != null || body.delaySec != null) await this.saveSettings({ template: body.template, delaySec: body.delaySec });

    const picked = await this.repo
      .createQueryBuilder('l')
      .where('l.outreach_status IS NULL')
      .andWhere("l.kanban_stage = 'novo'")
      .andWhere('l.phone IS NOT NULL')
      .andWhere(body.listName ? 'l.list_name = :listName' : '1=1', { listName: body.listName })
      .orderBy('l.priority', 'ASC', 'NULLS LAST')
      .addOrderBy('l.created_at', 'ASC')
      .limit(size)
      .getMany();
    if (!picked.length) throw new BadRequestException('Nenhum prospect disponível nessa lista (todos já receberam ou não estão em "Novo").');

    // Ordem da fila = ordem escolhida acima (1 ms de diferença entre cada).
    const base = Date.now();
    for (const [i, p] of picked.entries()) {
      await this.repo.update({ id: p.id, outreachStatus: IsNull() }, { outreachStatus: 'queued', outreachQueuedAt: new Date(base + i), outreachError: null });
    }
    await this.saveState({ running: true, listName: body.listName || null, nextAt: new Date().toISOString(), sentInRun: 0, consecutiveFails: 0, pausedReason: null });
    this.logger.log(`[Disparo] Lote iniciado: ${picked.length} prospect(s)${body.listName ? ` da lista "${body.listName}"` : ''}`);
    return this.overview(body.listName);
  }

  async pause() {
    return this.saveState({ running: false, pausedReason: 'Pausado por você' });
  }

  async resume() {
    const conn = await this.connection();
    if (!conn.connected) throw new BadRequestException('O número não está conectado.');
    return this.saveState({ running: true, nextAt: new Date().toISOString(), consecutiveFails: 0, pausedReason: null });
  }

  /** Tira da fila quem ainda não recebeu (volta a ficar disponível pra outro lote). */
  async cancel() {
    await this.repo.update({ outreachStatus: 'queued' }, { outreachStatus: null, outreachQueuedAt: null });
    return this.saveState({ running: false, nextAt: null, pausedReason: null });
  }

  /** Coloca de volta como disponível quem falhou (não mexe nos sem WhatsApp). */
  async retryFailed(listName?: string | null) {
    const res = await this.repo.update({ outreachStatus: 'failed', ...(listName ? { listName } : {}) }, { outreachStatus: null, outreachError: null });
    return { reset: res.affected || 0 };
  }

  private inWindow(state: OutreachState, d = new Date()): boolean {
    const { hour, weekday } = brtParts(d);
    if (weekday === 'Sun') return false;
    return hour >= state.startHour && hour < state.endHour;
  }

  @Cron('*/10 * * * * *')
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.processNext();
    } catch (e) {
      this.logger.error(`[Disparo] Erro no ciclo: ${e.message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async processNext() {
    const state = await this.getState();
    if (!state.running) return;
    if (state.nextAt && Date.now() < new Date(state.nextAt).getTime()) return;
    if (!this.inWindow(state)) return;
    if ((await this.sentToday()) >= state.dailyLimit) return;
    // Deploy sobrepondo containers: só um processo envia por vez.
    if (!(await this.settings.tryAcquireLock(OUTREACH_LOCK_KEY, 60_000))) return;

    try {
      // Reservado e nunca concluído (processo caiu no meio): volta pra fila.
      await this.repo.manager.query(
        `UPDATE coldcall_leads SET outreach_status = 'queued' WHERE outreach_status = 'sending' AND updated_at < now() - interval '5 minutes'`,
      );
      const rows: { id: string }[] = await this.repo.manager.query(
        `UPDATE coldcall_leads SET outreach_status = 'sending', updated_at = now()
         WHERE id = (SELECT id FROM coldcall_leads WHERE outreach_status = 'queued' ORDER BY outreach_queued_at LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING id`,
      );
      const row = Array.isArray(rows[0]) ? rows[0][0] : rows[0];
      if (!row?.id) {
        this.logger.log('[Disparo] Lote concluído');
        await this.saveState({ running: false, nextAt: null, pausedReason: null });
        return;
      }
      const lead = await this.repo.findOneByOrFail({ id: row.id });
      await this.sendOne(lead, state);
    } finally {
      await this.settings.set(OUTREACH_LOCK_KEY, new Date(0).toISOString());
    }
  }

  private async sendOne(lead: ColdCallLead, state: OutreachState) {
    const number = String(lead.phone || '').replace(/\D/g, '');

    // 1) Tem WhatsApp? Fixo sem WhatsApp é pulado e o próximo sai logo (não conta como envio).
    try {
      const check = await this.uazapi('/chat/check', 'POST', { numbers: [number] });
      const item = Array.isArray(check) ? check[0] : check?.[0] ?? check;
      if (item && item.isInWhatsapp === false) {
        await this.repo.update(lead.id, { outreachStatus: 'skipped', outreachError: 'Número sem WhatsApp' });
        await this.saveState({ nextAt: new Date(Date.now() + 5_000).toISOString() });
        return;
      }
    } catch (e) {
      if (e.status === 401) return this.failAndMaybePause(lead, state, 'Instância desconectada (401)', true);
      // Se a checagem falhar por outro motivo, tenta enviar mesmo assim.
      this.logger.warn(`[Disparo] Checagem de WhatsApp falhou pra ${lead.companyName}: ${e.message}`);
    }

    // 2) "digitando..." proporcional ao texto, depois envia.
    const text = renderTemplate(state.template, lead);
    const typing = Math.min(9000, Math.max(2500, Math.round(text.length * (1000 / 40))));
    try {
      await this.uazapi('/message/presence', 'POST', { number, presence: 'composing', delay: typing }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, typing));
      await this.uazapi('/send/text', 'POST', { number, text });
    } catch (e) {
      return this.failAndMaybePause(lead, state, e.message, e.status === 401);
    }

    await this.repo.update(lead.id, {
      outreachStatus: 'sent',
      outreachSentAt: new Date(),
      outreachMessage: text,
      outreachError: null,
    });

    const sentInRun = state.sentInRun + 1;
    const jitter = 0.7 + Math.random() * 0.7; // 70%–140% do intervalo escolhido
    let waitMs = state.delaySec * 1000 * jitter;
    if (sentInRun % LONG_PAUSE_EVERY === 0) waitMs += (3 + Math.random() * 3) * 60_000; // pausa longa de 3–6 min
    await this.saveState({ sentInRun, consecutiveFails: 0, nextAt: new Date(Date.now() + waitMs).toISOString() });
    this.logger.log(`[Disparo] Enviado pra ${lead.companyName} (${sentInRun} no lote), próximo em ${Math.round(waitMs / 1000)}s`);
  }

  private async failAndMaybePause(lead: ColdCallLead, state: OutreachState, error: string, disconnected: boolean) {
    await this.repo.update(lead.id, { outreachStatus: 'failed', outreachError: error.slice(0, 250) });
    const fails = state.consecutiveFails + 1;
    this.logger.error(`[Disparo] Falha pra ${lead.companyName}: ${error}`);
    if (disconnected || fails >= MAX_CONSECUTIVE_FAILS) {
      await this.saveState({
        running: false,
        consecutiveFails: fails,
        pausedReason: disconnected ? 'Pausado: o número desconectou' : `Pausado: ${fails} falhas seguidas`,
      });
      return;
    }
    await this.saveState({ consecutiveFails: fails, nextAt: new Date(Date.now() + state.delaySec * 1000).toISOString() });
  }
}
