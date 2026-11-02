import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { Lead } from '../common/entities/lead.entity';
import { LeadsService } from '../leads/leads.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService, MEETING_NOTIFY_PHONES_KEY } from '../settings/settings.service';
import { SDR_MODEL_KEY } from './sdr.prompt';
import {
  DEFAULT_EFRAIM_PROMPT,
  EFRAIM_DEFAULT_QUIZ_SLUGS,
  EFRAIM_ENABLED_KEY,
  EFRAIM_JSON_FORMAT,
  EFRAIM_PROMPT_KEY,
  EFRAIM_QUIZ_SLUGS_KEY,
} from './efraim-quiz.prompt';
import { AgendaService } from '../agenda/agenda.service';
import { WEEKDAYS, addDays, brt, brtAt, formatDayShiftHuman, formatSlotHuman } from '../common/brt.util';
import { isAutoReply } from './auto-reply.util';
import { extractCandidateFirstName } from './name-gender.util';

// Reexportado porque o controller e os testes pegam daqui.
export { formatSlotHuman };

// Mesma chave de SDR_NOTIFY_PHONES_KEY (sdr.controller.ts) — repetida aqui pra
// não criar import circular controller ↔ service.
const SDR_NOTIFY_PHONES_KEY = 'sdr_notify_phones';

/** Janela de envio da abertura (horário de Brasília). Fora dela, espera a próxima abertura da janela. */
const SEND_FROM_HOUR = 8;
const SEND_UNTIL_HOUR = 21;
/** Abertura que ficou pendente mais que isso (agente desligado, fora da janela...) não sai mais. */
const OPENING_STALE_HOURS = 14;
/** Horários "aleatórios" oferecidos enquanto não existe a agenda interna: início do par (h, h+1). */
const SLOT_START_HOURS = [10, 11, 14, 15, 16, 17];
/** Pausa entre uma bolha e a seguinte — o lead vê "digitando..." nesse tempo. */
const BUBBLE_GAP_MS = 5000;
/** Respostas do quiz que tiram o lead do Efraim (não é perfil pra reunião). */
const SKIP_ANSWERS = [/quero comprar cabelo/i, /n[aã]o [eé] o meu momento/i];


export type EfraimStage = 'conversando' | 'agendado' | 'sem_interesse' | 'humano';

export interface EfraimAiResult {
  reply: string;
  stage: EfraimStage;
  reuniao: string | null;
  botDoLead: boolean;
  success: boolean;
}

/**
 * Reserva: próximo dia útil (seg–sex) com 2 horários seguidos sorteados. Só
 * roda quando a agenda interna (/agenda) ainda não tem nenhum dia cadastrado —
 * aí é melhor oferecer um horário plausível que não oferecer nenhum.
 */
export function computeSlots(now: Date): Date[] {
  const out: Date[] = [];
  let day = addDays(now, 1);
  for (let i = 0; i < 2; i++) {
    while ([0, 6].includes(brt(day).weekday)) day = addDays(day, 1);
    const start = SLOT_START_HOURS[Math.floor(Math.random() * SLOT_START_HOURS.length)];
    const ymd = brt(day).ymd;
    out.push(brtAt(ymd, start), brtAt(ymd, start + 1));
    day = addDays(day, 1);
  }
  return out;
}

/** Primeiro nome pra saudação; mantém nomes compostos comuns ("Ana Paula", "Maria Clara"). */
function greetingName(rawName?: string | null): string | null {
  const first = extractCandidateFirstName(rawName || '');
  if (!first) return null;
  const tokens = (rawName || '').trim().split(/\s+/);
  const second = tokens[1];
  const compound = ['ana', 'maria', 'joão', 'joao', 'luiz', 'luis', 'josé', 'jose', 'pedro', 'paulo'];
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  if (second && compound.includes(first.toLowerCase()) && /^[A-Za-zÀ-ÖØ-öø-ÿ]{3,}$/.test(second) && !/^(da|de|do|dos|das)$/i.test(second)) {
    return `${cap(first)} ${cap(second)}`;
  }
  return cap(first);
}

export function buildEfraimGreeting(rawName: string | null | undefined, now: Date): string {
  const h = brt(now).hour;
  const period = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const name = greetingName(rawName);
  return name ? `${period} ${name}, tudo bem?` : `${period}, tudo bem?`;
}

/** Calendário dos próximos dias — a IA usa pra converter "amanhã"/"quarta" em data. */
function calendarContext(now: Date): string {
  const n = brt(now);
  const days: string[] = [];
  for (let i = 0; i < 8; i++) {
    const d = brt(addDays(now, i));
    days.push(`${WEEKDAYS[d.weekday]} ${d.day}/${d.month}/${d.ymd.slice(0, 4)}${i === 0 ? ' (hoje)' : i === 1 ? ' (amanhã)' : ''}`);
  }
  return `- Agora: ${WEEKDAYS[n.weekday]} ${n.day}/${n.month} às ${String(n.hour).padStart(2, '0')}:${String(n.minute).padStart(2, '0')} (horário de Brasília)\n- Calendário: ${days.join(' · ')}`;
}

export interface EfraimLeadSnapshot {
  name?: string | null;
  quizResponses?: { question: string; answer: string }[] | null;
  meetingAt?: Date | string | null;
  efraimSlots?: string[] | null;
  /** Horários livres da agenda interna, já em texto ("amanhã (terça, 03/11): 10h, 11h · …"). */
  agendaSummary?: string | null;
}

/** "Abaixo de 20k mês" → "até 20 mil"; "Entre 30k e 50k mês" → "entre 30 e 50 mil"; "Acima de 100k" → "mais de 100 mil". */
function spokenRevenue(answer: string): string {
  return answer
    .replace(/\s*(por\s+)?m[eê]s\b\.?/gi, '')
    .replace(/(\d+)\s*k\b/gi, '$1 mil')
    .replace(/(\d+) mil e (\d+) mil/i, '$1 e $2 mil')
    .replace(/^abaixo de/i, 'até')
    .replace(/^acima de/i, 'mais de')
    .replace(/R\$\s*/gi, '')
    .replace(/^(at[eé]|entre|mais de)(?=\s)/i, (m) => m.toLowerCase())
    .trim();
}

function buildLeadContext(lead: EfraimLeadSnapshot, now: Date, greeting?: string): string {
  const lines: string[] = [];
  if (lead.name) lines.push(`- Nome: ${lead.name}`);
  const answers = (lead.quizResponses || []).filter((a) => a?.question && a?.answer);
  if (answers.length) {
    lines.push('- Respostas do quiz:');
    for (const a of answers) lines.push(`  • ${a.question} → ${a.answer}`);
    const revenue = answers.find((a) => /faturamento/i.test(a.question));
    if (revenue) lines.push(`- Faturamento falado (use assim na mensagem): "${spokenRevenue(revenue.answer)}"`);
  }
  if (lead.meetingAt) {
    lines.push(`- Reunião JÁ AGENDADA pela própria pessoa: ${formatSlotHuman(new Date(lead.meetingAt), now)}. Na bolha 3 CONFIRME exatamente esse dia e horário (ela já agendou) — NÃO ofereça opções de horário.`);
  } else if (lead.efraimSlots?.length) {
    const offered = lead.efraimSlots.map((s) => new Date(s));
    lines.push(
      `- Dias/turnos a oferecer na bolha 3 (copie exatamente assim, SEM dizer hora): "${formatDayShiftHuman(offered, now)}"`,
    );
  }
  if (lead.agendaSummary) {
    lines.push(
      `- AGENDA (únicos horários que existem): ${lead.agendaSummary}`,
      '- Se a pessoa recusar os sugeridos ou pedir outro dia, ofereça SÓ horários desta agenda, começando pelos dias mais próximos. Nunca invente um horário que não esteja aqui. Se nada serve, diga que vai ver outras opções e passe pra equipe (stage "humano").',
    );
  }
  if (greeting) lines.push(`- Saudação de abertura (bolha 1 da PRIMEIRA MENSAGEM): "${greeting}"`);
  lines.push(calendarContext(now));
  return `\nCONTEXTO DO LEAD:\n${lines.join('\n')}`;
}

export function buildEfraimSystemPrompt(basePrompt: string, lead: EfraimLeadSnapshot, now: Date, greeting?: string): string {
  return `${basePrompt}\n${buildLeadContext(lead, now, greeting)}\n\n${EFRAIM_JSON_FORMAT}`;
}

export const OPENING_TRIGGER = '[SISTEMA] A pessoa acabou de terminar o quiz e ainda não falou nada. Escreva agora a PRIMEIRA MENSAGEM.';

@Injectable()
export class EfraimQuizService {
  private readonly logger = new Logger(EfraimQuizService.name);
  private readonly openai: OpenAI;
  private readonly defaultModel: string;
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;
  private running = false;

  constructor(
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    private readonly leadsService: LeadsService,
    private readonly realtime: RealtimeGateway,
    private readonly settings: SettingsService,
    private readonly http: HttpService,
    private readonly agenda: AgendaService,
    config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    this.defaultModel = config.get('SDR_OPENAI_MODEL') || 'gpt-5.4-mini';
    // Mesmo número da Sofia (instância SDR do CRM).
    this.uazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || 'https://free.uazapi.com';
    this.uazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
  }

  // ─── Configuração ────────────────────────────────────────────────────────

  async getPrompt(): Promise<string> {
    return (await this.settings.get(EFRAIM_PROMPT_KEY)) || DEFAULT_EFRAIM_PROMPT;
  }

  async getConfig(): Promise<{ enabled: boolean; quizSlugs: string[] }> {
    const [enabled, slugs] = await Promise.all([this.settings.get(EFRAIM_ENABLED_KEY), this.settings.get(EFRAIM_QUIZ_SLUGS_KEY)]);
    return {
      enabled: enabled === 'true',
      quizSlugs: (slugs ?? EFRAIM_DEFAULT_QUIZ_SLUGS).split(',').map((s) => s.trim()).filter(Boolean),
    };
  }

  // ─── Agenda interna ──────────────────────────────────────────────────────

  /**
   * Os dois horários que o Efraim afirma na abertura. Vêm da agenda interna
   * (/agenda); sem nenhum dia cadastrado lá, cai no sorteio antigo pra não
   * deixar o lead sem proposta de horário.
   */
  private async offeredSlots(now: Date): Promise<string[]> {
    try {
      const slots = await this.agenda.openingSlots(now);
      if (slots.length) return slots.map((d) => d.toISOString());
      this.logger.warn('[Efraim] Agenda interna sem horário livre — usando horários sorteados');
    } catch (err: any) {
      this.logger.error(`[Efraim] Erro lendo a agenda: ${err.message} — usando horários sorteados`);
    }
    return computeSlots(now).map((d) => d.toISOString());
  }

  private async agendaSummary(now: Date): Promise<string> {
    try {
      return await this.agenda.agendaSummary(now);
    } catch {
      return '';
    }
  }

  // ─── IA ──────────────────────────────────────────────────────────────────

  private async callAi(lead: EfraimLeadSnapshot, history: { role: 'user' | 'assistant'; content: string }[], incoming: string, now: Date, greeting?: string): Promise<EfraimAiResult> {
    const basePrompt = await this.getPrompt();
    const model = (await this.settings.get(SDR_MODEL_KEY)) || this.defaultModel;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildEfraimSystemPrompt(basePrompt, lead, now, greeting) },
      ...history,
      { role: 'user', content: incoming },
    ];
    try {
      const res = await this.openai.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        // Modelo de raciocínio: os tokens de "pensamento" saem do mesmo budget (ver sdr.service.ts).
        max_completion_tokens: 900,
        response_format: { type: 'json_object' },
      });
      const raw = (res.choices[0].message.content || '').trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Resposta sem JSON');
      const parsed = JSON.parse(match[0]);
      const botDoLead = parsed.botDoLead === true;
      // Limpa "\n" literal e caracteres de controle que o modelo às vezes solta no meio do texto.
      const reply = typeof parsed.reply === 'string'
        ? parsed.reply.replace(/\\n/g, '\n').replace(/\r/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g, ' ').replace(/[ \t]+\n/g, '\n').trim()
        : '';
      const stage: EfraimStage = ['conversando', 'agendado', 'sem_interesse', 'humano'].includes(parsed.stage) ? parsed.stage : 'conversando';
      if (!reply && !botDoLead) throw new Error(`JSON incompleto (reply vazio, stage=${parsed.stage})`);
      return { reply, stage, reuniao: typeof parsed.reuniao === 'string' ? parsed.reuniao : null, botDoLead, success: true };
    } catch (err: any) {
      this.logger.error(`[Efraim] Erro na IA: ${err.message}`);
      return { reply: '', stage: 'conversando', reuniao: null, botDoLead: false, success: false };
    }
  }

  private async callAiWithRetry(...args: Parameters<EfraimQuizService['callAi']>): Promise<EfraimAiResult> {
    const first = await this.callAi(...args);
    if (first.success) return first;
    await new Promise((r) => setTimeout(r, 2000));
    return this.callAi(...args);
  }

  /** Força a bolha 1 = saudação calculada no código (a IA já errou isso na Sofia). */
  private forceGreeting(reply: string, greeting: string): string {
    const bubbles = reply.split('|||').map((b) => b.trim()).filter(Boolean);
    if (bubbles.length <= 1 || !/tudo bem|bom dia|boa tarde|boa noite|ol[aá]|oi\b/i.test(bubbles[0])) bubbles.unshift(greeting);
    else bubbles[0] = greeting;
    return bubbles.join('|||');
  }

  /** Data combinada válida: futura, até 30 dias. */
  private parseMeeting(iso: string | null): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const diff = d.getTime() - Date.now();
    if (diff < 0 || diff > 30 * 86_400_000) return null;
    return d;
  }

  // ─── Simulador (Configurações) ───────────────────────────────────────────

  async getSample(): Promise<{ name: string; quizResponses: { question: string; answer: string }[] }> {
    const { quizSlugs } = await this.getConfig();
    const lead = quizSlugs.length
      ? await this.leadsRepo
          .createQueryBuilder('lead')
          .select(['lead.name', 'lead.quizResponses'])
          .where('lead.quiz_slug IN (:...slugs)', { slugs: quizSlugs })
          .andWhere('lead.quiz_responses IS NOT NULL')
          .orderBy('lead.created_at', 'DESC')
          .getOne()
      : null;
    return {
      name: lead?.name || 'Ana Paula',
      quizResponses: lead?.quizResponses?.length
        ? lead.quizResponses
        : [
            { question: 'Hoje você trabalha com:', answer: 'Venda de cabelo' },
            { question: 'Quantas mensagens em média você recebe por dia no WhatsApp?', answer: 'Entre 10 e 20' },
            { question: 'Qual o seu faturamento médio mensal?', answer: 'Abaixo de 20k mês' },
          ],
    };
  }

  async simulate(body: {
    message?: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
    name?: string;
    quizResponses?: { question: string; answer: string }[];
    slots?: string[];
  }) {
    const now = new Date();
    const history = (body.history || []).filter((m) => m?.content);
    const isOpening = history.length === 0 && !(body.message || '').trim();
    const slots = body.slots?.length ? body.slots : await this.offeredSlots(now);
    const agendaSummary = await this.agendaSummary(now);
    const snapshot: EfraimLeadSnapshot = { name: body.name, quizResponses: body.quizResponses, efraimSlots: slots, agendaSummary };
    const greeting = isOpening ? buildEfraimGreeting(body.name, now) : undefined;
    const ai = await this.callAi(snapshot, history, isOpening ? OPENING_TRIGGER : (body.message || '').trim(), now, greeting);
    if (!ai.success) throw new Error('A IA não respondeu — tente de novo');
    if (greeting && ai.reply) ai.reply = this.forceGreeting(ai.reply, greeting);
    return {
      reply: ai.reply.replace(/\|\|\|/g, '\n\n'),
      // Uma entrada por bolha: é assim que chega no WhatsApp (5s entre elas).
      bubbles: ai.reply.split('|||').map((b) => b.trim()).filter(Boolean),
      stage: isOpening ? 'abertura' : ai.stage,
      reuniao: ai.reuniao,
      reuniaoHuman: this.parseMeeting(ai.reuniao) ? formatSlotHuman(new Date(ai.reuniao!), now) : null,
      botDoLead: ai.botDoLead,
      slots,
      agendaSummary,
    };
  }

  // ─── Abertura proativa (agendada no submit do quiz) ──────────────────────

  @Cron('*/1 * * * *')
  async sendDueOpenings() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const h = brt(now).hour;
      if (h < SEND_FROM_HOUR || h >= SEND_UNTIL_HOUR) return;
      const { enabled, quizSlugs } = await this.getConfig();
      if (!enabled || !quizSlugs.length || !this.uazapiToken) return;

      const due = await this.leadsRepo
        .createQueryBuilder('lead')
        .select(['lead.id'])
        .where('lead.efraim_opening_at <= :now', { now })
        .andWhere('lead.efraim_opening_at > :stale', { stale: new Date(now.getTime() - OPENING_STALE_HOURS * 3_600_000) })
        .andWhere('lead.efraim_opening_sent_at IS NULL')
        .andWhere('lead.quiz_slug IN (:...slugs)', { slugs: quizSlugs })
        .orderBy('lead.efraim_opening_at', 'ASC')
        .limit(10)
        .getMany();

      for (const { id } of due) {
        // Reserva atômica: se 2 instâncias (deploy sobreposto) pegarem o mesmo lead, só uma envia.
        const claimed = await this.leadsRepo
          .createQueryBuilder()
          .update(Lead)
          .set({ efraimOpeningSentAt: new Date() })
          .where('id = :id AND efraim_opening_sent_at IS NULL', { id })
          .execute();
        if (!claimed.affected) continue;
        await this.sendOpening(id).catch((err) => this.logger.error(`[Efraim] Erro na abertura do lead ${id}: ${err.message}`));
      }
    } finally {
      this.running = false;
    }
  }

  private skipReason(lead: Lead): string | null {
    if (lead.aiAgent === 'efraim') return 'já está com o Efraim';
    if (Array.isArray(lead.aiContext) && lead.aiContext.length > 0) return 'já tem conversa no WhatsApp';
    if (lead.kanbanStage !== 'novo') return `card já foi movido (${lead.kanbanStage})`;
    if (lead.status === 'perdido' || lead.status === 'convertido') return `status ${lead.status}`;
    const skipAnswer = (lead.quizResponses || []).find((a) => SKIP_ANSWERS.some((re) => re.test(a.answer || '')));
    if (skipAnswer) return `resposta "${skipAnswer.answer}"`;
    return null;
  }

  private async sendOpening(leadId: string) {
    const lead = await this.leadsService.findById(leadId);
    const reason = this.skipReason(lead);
    if (reason) {
      this.logger.log(`[Efraim] Abertura pulada pro lead ${lead.phone} — ${reason}`);
      return;
    }

    const now = new Date();
    const slots = lead.meetingAt ? [] : await this.offeredSlots(now);
    const greeting = buildEfraimGreeting(lead.name, now);
    const snapshot: EfraimLeadSnapshot = {
      name: lead.name,
      quizResponses: lead.quizResponses,
      meetingAt: lead.meetingAt,
      efraimSlots: slots,
      agendaSummary: lead.meetingAt ? '' : await this.agendaSummary(now),
    };
    const ai = await this.callAiWithRetry(snapshot, [], OPENING_TRIGGER, now, greeting);

    let reply: string;
    if (ai.success && ai.reply) {
      reply = this.forceGreeting(ai.reply, greeting);
    } else {
      // IA fora do ar: texto fixo no mesmo estilo, a abertura não se perde.
      const third = lead.meetingAt
        ? `Você agendou nossa reunião pra ${formatSlotHuman(new Date(lead.meetingAt), now)}, já está na agenda aqui! 1h antes te envio o link da sala`
        : `Quero deixar marcada nossa reunião de apresentação do método. Tenho ${formatDayShiftHuman(slots.map((s) => new Date(s)), now)}. Qual horário fica melhor pra você?`;
      reply = [greeting, 'Aqui é o Fagner da Convert Hair, vi que você respondeu nosso quiz pra vender mais cabelo com tráfego pago. É uma ótima oportunidade pra gente dobrar o seu faturamento', third].join('|||');
      this.logger.warn(`[Efraim] IA falhou na abertura de ${lead.phone} — usando texto fixo`);
    }

    const timestamp = new Date().toISOString();
    const content = reply.replace(/\|\|\|/g, '\n');
    const updated = await this.leadsService.update(lead.id, {
      aiAgent: 'efraim',
      aiPaused: false,
      waStage: 'abertura' as any,
      waLastMessageAt: new Date(),
      efraimSlots: slots.length ? slots : null,
      aiContext: [{ role: 'assistant', source: 'efraim', content, timestamp }] as any,
    });
    const ids = await this.sendBubbles(lead.phone, reply);
    await this.leadsService.attachWaMessageIds(lead.id, timestamp, ids).catch(() => undefined);
    this.realtime.emitLeadUpdated(updated);
    this.logger.log(`[Efraim] Abertura enviada pro lead ${lead.phone} (${ids.length} bolha(s))`);
  }

  // ─── Respostas do lead (chamado pelo SdrController) ──────────────────────

  async handleReply(lead: Lead, text: string, incomingMedia?: { mediaType: string; mediaUrl: string }) {
    const now = new Date();
    const userEntry = { role: 'user', content: text, timestamp: now.toISOString(), ...(incomingMedia || {}) };
    const prior: any[] = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    const kanbanPatch: Partial<Lead> = !lead.kanbanStageManual && lead.kanbanStage === 'novo' ? { kanbanStage: 'atendimento' as any } : {};

    const recordOnly = async (why: string) => {
      const updated = await this.leadsService.update(lead.id, { aiContext: [...prior, userEntry] as any, waLastMessageAt: now, ...kanbanPatch });
      this.realtime.emitLeadUpdated(updated);
      this.logger.log(`[Efraim] ${lead.phone}: ${why} — mensagem registrada, sem resposta`);
    };

    // Resposta automática de ausência / IA de atendimento do próprio lead.
    if (isAutoReply(text)) return recordOnly('resposta automática do lead');

    const history = prior
      .filter((m) => !m.internal && !m.whatsappDeleted && m.content)
      .map((m) => ({ role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant', content: String(m.content) }));
    const snapshot: EfraimLeadSnapshot = {
      name: lead.name,
      quizResponses: lead.quizResponses,
      meetingAt: lead.meetingAt,
      efraimSlots: lead.efraimSlots,
      agendaSummary: await this.agendaSummary(now),
    };
    const ai = await this.callAiWithRetry(snapshot, history, text, now);
    if (!ai.success) return recordOnly('IA falhou');
    if (ai.botDoLead) return recordOnly('IA/atendente automático do lead');

    // Loop: mesma resposta 3x seguidas → pausa e avisa.
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const lastTwo = prior.filter((m) => m.role === 'assistant' && m.content).slice(-2).map((m) => norm(String(m.content)));
    const replyNorm = norm(ai.reply.replace(/\|\|\|/g, ' '));
    if (replyNorm.length >= 8 && lastTwo.length === 2 && lastTwo.every((t) => t === replyNorm)) {
      const updated = await this.leadsService.update(lead.id, { aiContext: [...prior, userEntry] as any, waLastMessageAt: now, aiPaused: true, ...kanbanPatch });
      this.realtime.emitLeadUpdated(updated);
      await this.notify(SDR_NOTIFY_PHONES_KEY, `⚠️ Efraim travou repetindo a mesma resposta — IA pausada.\n\nLead: ${lead.name}\nWhatsApp: ${lead.phone}\n\nAssuma a conversa.`);
      return;
    }

    const meeting = ai.stage === 'agendado' ? this.parseMeeting(ai.reuniao) : null;
    if (ai.stage === 'agendado' && !meeting) this.logger.warn(`[Efraim] ${lead.phone}: stage agendado sem data válida (reuniao=${ai.reuniao}) — segue conversando`);
    const finished = Boolean(meeting) || ai.stage === 'sem_interesse' || ai.stage === 'humano';

    const timestamp = new Date().toISOString();
    const patch: Partial<Lead> = {
      aiContext: [...prior, userEntry, { role: 'assistant', source: 'efraim', content: ai.reply.replace(/\|\|\|/g, '\n'), timestamp }] as any,
      waLastMessageAt: new Date(),
      waStage: (finished ? 'encerrado' : 'qualificacao') as any,
      ...kanbanPatch,
    };
    if (finished) patch.aiPaused = true;
    if (meeting) patch.meetingAt = meeting;
    if (ai.stage === 'sem_interesse') patch.temperature = 'frio' as any;

    const previousMeeting = lead.meetingAt ? new Date(lead.meetingAt) : null;
    const updated = await this.leadsService.update(lead.id, patch);
    const ids = await this.sendBubbles(lead.phone, ai.reply);
    await this.leadsService.attachWaMessageIds(lead.id, timestamp, ids).catch(() => undefined);
    this.realtime.emitLeadUpdated(updated);

    if (meeting && previousMeeting?.getTime() !== meeting.getTime()) {
      this.logger.log(`[Efraim] Reunião marcada com ${lead.phone}: ${meeting.toISOString()}`);
      // Fora da agenda interna só vira aviso: a pessoa já combinou esse horário
      // na conversa, cancelar por conta própria seria pior.
      const offAgenda = await this.agenda.checkSlot(meeting, now).catch(() => null);
      if (offAgenda) this.logger.warn(`[Efraim] Reunião de ${lead.phone} ${offAgenda} — confira na agenda`);
      await this.notify(MEETING_NOTIFY_PHONES_KEY, [
        previousMeeting ? '🔁 Reunião remarcada pelo Efraim!' : '📅 Reunião agendada pelo Efraim!',
        '',
        `Lead: ${lead.name}`,
        `WhatsApp: ${lead.phone}`,
        `Quando: ${formatSlotHuman(meeting, new Date())}`,
        ...(previousMeeting ? [`Antes: ${formatSlotHuman(previousMeeting, new Date())}`] : []),
        ...(offAgenda ? ['', `⚠️ Esse horário ${offAgenda} — confira na agenda do CRM.`] : []),
        '',
        'Já está na agenda do CRM. Lembre de mandar o link da sala 1h antes (o Efraim prometeu).',
      ].join('\n'));
    } else if (ai.stage === 'humano' || ai.stage === 'sem_interesse') {
      await this.notify(SDR_NOTIFY_PHONES_KEY, [
        ai.stage === 'humano' ? '🙋 Lead do quiz precisa de você (Efraim pausou)' : '👋 Lead do quiz disse que não tem interesse (Efraim pausou)',
        '',
        `Lead: ${lead.name}`,
        `WhatsApp: ${lead.phone}`,
        `Última mensagem: "${text.length > 300 ? `${text.slice(0, 300)}…` : text}"`,
      ].join('\n'));
    }
  }

  // ─── WhatsApp (uazapi, instância do SDR) ─────────────────────────────────

  private async notify(settingKey: string, text: string) {
    const stored = await this.settings.get(settingKey);
    const phones = stored ? stored.split(',').map((p) => p.trim()).filter(Boolean) : [];
    await Promise.allSettled(phones.map((number) => this.sendText(number, text)));
  }

  private async sendText(phone: string, text: string): Promise<string | null> {
    try {
      const number = phone.startsWith('55') ? phone : `55${phone}`;
      const res = await firstValueFrom(this.http.post(`${this.uazapiBaseUrl}/send/text`, { number, text }, { headers: { token: this.uazapiToken } }));
      return (res.data as any)?.messageid ?? null;
    } catch (err: any) {
      this.logger.error(`[Efraim] Erro ao enviar pra ${phone}: ${err.message}`);
      return null;
    }
  }

  private async sendBubbles(phone: string, reply: string): Promise<string[]> {
    const ids: string[] = [];
    const bubbles = reply.split('|||').map((b) => b.trim()).filter(Boolean);
    for (const [index, bubble] of bubbles.entries()) {
      // A 1ª sai quase na hora (só o tempo de "digitando", ~45 caracteres/s,
      // como a Sofia); as seguintes esperam BUBBLE_GAP_MS pra conversa não
      // chegar em bloco. O "digitando..." fica aparecendo nesse intervalo.
      const typing = Math.min(8000, Math.max(1200, Math.round(bubble.length * (1000 / 45))));
      const delay = index === 0 ? typing : BUBBLE_GAP_MS;
      const number = phone.startsWith('55') ? phone : `55${phone}`;
      await firstValueFrom(
        this.http.post(`${this.uazapiBaseUrl}/message/presence`, { number, presence: 'composing', delay }, { headers: { token: this.uazapiToken } }),
      ).catch(() => undefined);
      await new Promise((r) => setTimeout(r, delay));
      const id = await this.sendText(phone, bubble);
      if (id) ids.push(id);
    }
    return ids;
  }
}
