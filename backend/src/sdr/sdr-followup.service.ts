import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { Lead } from '../common/entities/lead.entity';
import { FollowupRule, CadenceStep } from '../common/entities/followup-rule.entity';
import { FollowupVideo } from '../common/entities/followup-video.entity';
import { SettingsService } from '../settings/settings.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SDR_MODEL_KEY } from './sdr.prompt';

// Chaves da config global antiga (1 regra só) — usadas só pra migração automática
// pra 1ª FollowupRule na primeira vez que o sistema roda com a tabela vazia.
const FOLLOWUP_ENABLED_KEY = 'sdr_followup_enabled';
const FOLLOWUP_DELAY_KEY = 'sdr_followup_delay_minutes';
const FOLLOWUP_MODE_KEY = 'sdr_followup_mode';
const FOLLOWUP_TEXT_KEY = 'sdr_followup_text';

// Teto diário de envio de vídeo no follow-up (configurável na tela).
const VIDEO_LIMIT_KEY = 'sdr_video_daily_limit';
const DEFAULT_VIDEO_LIMIT = 15;

export { FOLLOWUP_ENABLED_KEY, FOLLOWUP_DELAY_KEY, FOLLOWUP_MODE_KEY, FOLLOWUP_TEXT_KEY, VIDEO_LIMIT_KEY, DEFAULT_VIDEO_LIMIT };

@Injectable()
export class SdrFollowupService {
  private readonly logger = new Logger(SdrFollowupService.name);
  private readonly openai: OpenAI;
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;
  private rulesSeeded = false;

  // Teto diário de vídeo — contador em memória, reseta quando muda o dia (BRT).
  private videoSentToday = 0;
  private videoSentDate = '';

  // Telemetria do cron (exposta em getStatus para o painel)
  private lastRunAt: Date | null = null;
  private lastSentCount = 0;

  constructor(
    @InjectRepository(Lead)
    private leadsRepo: Repository<Lead>,
    @InjectRepository(FollowupRule)
    private rulesRepo: Repository<FollowupRule>,
    @InjectRepository(FollowupVideo)
    private videoRepo: Repository<FollowupVideo>,
    private settings: SettingsService,
    private http: HttpService,
    private config: ConfigService,
    private realtime: RealtimeGateway,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    this.uazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || '';
    this.uazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
  }

  /**
   * Migração automática: se a tabela de regras estiver vazia e existir a config
   * global antiga (1 regra só, era via `settings`), cria 1 FollowupRule "Regra
   * padrão" com os valores antigos — preserva o comportamento até o operador
   * reconfigurar. Roda 1x (lazy, na primeira chamada do cron ou do painel).
   */
  async ensureRulesSeeded(): Promise<void> {
    if (this.rulesSeeded) return;
    this.rulesSeeded = true;

    const existing = await this.rulesRepo.count();
    if (existing > 0) return;

    const enabledRow = await this.settings.getRow(FOLLOWUP_ENABLED_KEY);
    if (!enabledRow) return;

    const delayMinutes = parseInt((await this.settings.get(FOLLOWUP_DELAY_KEY)) || '60', 10);
    const mode = (await this.settings.get(FOLLOWUP_MODE_KEY)) === 'ai' ? 'ai' : 'manual';
    const text = (await this.settings.get(FOLLOWUP_TEXT_KEY)) || '';

    await this.rulesRepo.save(this.rulesRepo.create({
      name: 'Regra padrão (todas as raias e campanhas)',
      enabled: enabledRow.value === 'true',
      kanbanStage: null,
      utmCampaign: null,
      delayMinutes,
      mode,
      text,
    }));
    this.logger.log('[Followup] Config antiga migrada para "Regra padrão" em followup_rules');
  }

  /** Regra mais específica que casa com o lead (raia + campanha + criativo + data > coringa). Undefined se nenhuma casar. */
  private matchRule(lead: Lead, rules: FollowupRule[]): FollowupRule | undefined {
    let best: FollowupRule | undefined;
    let bestScore = -1;
    for (const rule of rules) {
      const stageOk = rule.kanbanStage == null || rule.kanbanStage === lead.kanbanStage;
      const campaignOk = rule.utmCampaign == null || rule.utmCampaign === lead.utmCampaign;
      const adTitleOk = rule.adTitle == null || rule.adTitle === lead.ctwaAdTitle;
      const createdAfterOk = rule.createdAfter == null || new Date(lead.createdAt).getTime() >= new Date(rule.createdAfter).getTime();
      if (!stageOk || !campaignOk || !adTitleOk || !createdAfterOk) continue;

      const score = (rule.kanbanStage != null ? 1 : 0) + (rule.utmCampaign != null ? 1 : 0)
        + (rule.adTitle != null ? 1 : 0) + (rule.createdAfter != null ? 1 : 0);
      if (
        score > bestScore ||
        (score === bestScore && best && (rule.priority < best.priority ||
          (rule.priority === best.priority && rule.createdAt < best.createdAt)))
      ) {
        best = rule;
        bestScore = score;
      }
    }
    return best;
  }

  /** Passos da cadência da regra, ou null se ela é de disparo único (comportamento antigo). */
  private cadenceStepsOf(rule: FollowupRule): CadenceStep[] | null {
    const steps = rule.cadenceSteps;
    if (!Array.isArray(steps) || steps.length === 0) return null;
    return steps;
  }

  /** Menor espera possível da regra — 1º toque da cadência, ou o delay único. */
  private minDelayOf(rule: FollowupRule): number {
    const steps = this.cadenceStepsOf(rule);
    if (!steps) return rule.delayMinutes;
    return Math.min(...steps.map((s) => Math.max(1, s.delayMinutes)));
  }

  /**
   * Decide o que a regra deve mandar pro lead AGORA. Retorna undefined quando
   * ainda não está na hora, quando a cadência já terminou ou quando a regra de
   * disparo único já foi usada. Concentra num lugar só a diferença entre os
   * dois modos, pra o cron e o painel não divergirem.
   */
  private resolveDueTouch(lead: Lead, rule: FollowupRule):
    | { step: CadenceStep; index: number; total: number; nextAt: Date | null }
    | { step: null }
    | undefined {
    const lastMs = new Date(lead.waLastMessageAt!).getTime();
    const steps = this.cadenceStepsOf(rule);

    if (!steps) {
      // Disparo único: só quem nunca recebeu follow-up.
      if (lead.followupSentAt) return undefined;
      if (lastMs > Date.now() - rule.delayMinutes * 60_000) return undefined;
      return { step: null };
    }

    const index = lead.followupStep ?? 0;
    if (index >= steps.length) return undefined; // cadência concluída
    // A partir do 2º toque o lead precisa estar de fato dentro de uma cadência
    // em andamento — sem isso, um lead que já recebeu follow-up por outra regra
    // entraria no meio da sequência.
    if (index > 0 && !lead.followupNextAt) return undefined;

    const step = steps[index];
    const delay = Math.max(1, step.delayMinutes);
    if (lastMs > Date.now() - delay * 60_000) return undefined;

    const nextIndex = index + 1;
    const nextAt = nextIndex < steps.length
      ? new Date(Date.now() + Math.max(1, steps[nextIndex].delayMinutes) * 60_000)
      : null;
    return { step, index, total: steps.length, nextAt };
  }

  @Cron('*/5 * * * *')
  async checkFollowups() {
    this.lastRunAt = new Date();
    await this.ensureRulesSeeded();

    const rules = await this.rulesRepo.find({ where: { enabled: true } });
    if (rules.length === 0) return;

    // Corte de tempo mínimo possível: nenhuma regra ativa dispara antes do seu
    // próprio delayMinutes, então quem mandou a última mensagem há menos tempo
    // que a MENOR regra nunca poderia estar due ainda — filtra isso direto no
    // SQL em vez de trazer o lead pra descartar em memória. O filtro exato por
    // regra (que pode ser mais rígido que esse mínimo) continua abaixo, por lead.
    const minDelayMinutes = Math.min(...rules.map((r) => this.minDelayOf(r)));
    const earliestCutoff = new Date(Date.now() - minDelayMinutes * 60_000);

    // Candidatos: nunca recebeu follow-up (followup_sent_at IS NULL garante 1x;
    // reseta quando o lead responde ou quando o operador reconfigura). ai_paused
    // NÃO é filtrado aqui em SQL — é checado por lead depois de casar a regra,
    // porque uma regra pode marcar ignoreAiPaused=true (ex.: raia "qualificado",
    // que pausa a IA no handoff pro operador mas ainda assim deve receber uma
    // campanha de reativação pontual). O escopo real por raia é aplicado no
    // matchRule() — só quem casa com uma regra ativa (raia+campanha+criativo) sai
    // daqui com mensagem de fato.
    //
    // .select() explícito: traz só as colunas que o loop abaixo (matchRule,
    // lastMessageWasFromAI, generateAiFollowup, sendFollowup) realmente usa —
    // evita puxar enrichment_data/ai_insight/tags/form_answers (jsonb pesados,
    // não usados aqui) pra cada linha a cada 5 minutos. Isso sozinho já era o
    // maior consumidor de egress do Supabase nesse cron.
    const candidates = await this.leadsRepo
      .createQueryBuilder('lead')
      .select([
        'lead.id',
        'lead.name',
        'lead.phone',
        'lead.kanbanStage',
        'lead.utmCampaign',
        'lead.ctwaAdTitle',
        'lead.createdAt',
        'lead.waLastMessageAt',
        'lead.followupSentAt',
        'lead.followupStep',
        'lead.followupNextAt',
        'lead.aiContext',
        'lead.aiPaused',
        'lead.notes',
      ])
      .where('lead.agent_mode = :mode', { mode: 'sdr' })
      .andWhere('lead.wa_last_message_at IS NOT NULL')
      .andWhere('lead.wa_last_message_at <= :earliestCutoff', { earliestCutoff })
      // Nunca recebeu follow-up (candidato ao 1º toque) OU está no meio de uma
      // cadência (followup_next_at preenchido). Quando a cadência termina, o
      // followup_next_at volta a null e o lead sai daqui de vez.
      .andWhere('(lead.followup_sent_at IS NULL OR lead.followup_next_at IS NOT NULL)')
      .getMany();

    const videoLimit = await this.getVideoLimit();

    let sent = 0;
    for (const lead of candidates) {
      if (!this.lastMessageWasFromAI(lead)) continue;

      const rule = this.matchRule(lead, rules);
      if (!rule) continue;

      if (lead.aiPaused && !rule.ignoreAiPaused) continue;

      // Decide qual toque está devido (cadência) ou se o disparo único já venceu.
      const due = this.resolveDueTouch(lead, rule);
      if (!due) continue;
      const cadence = 'index' in due ? due : null;

      // Horário preferido: mesmo com o prazo de inatividade vencido há muito
      // tempo, só dispara dentro da janela do horário configurado (hoje).
      // Não pode comparar contra o momento em que o lead ficou elegível — se
      // esse momento já passou há dias, "a partir de agora" ficaria sempre
      // verdadeiro e dispararia na hora em vez de esperar o horário certo.
      // Numa cadência diária isso é o que impede o toque de sair de madrugada.
      if (rule.sendAtHour != null && !this.isWithinSendWindow(rule.sendAtHour, rule.sendAtMinute ?? 0)) {
        continue;
      }

      // Regra com vídeo: manda o vídeo (com legenda), respeitando o teto diário.
      // Só vale no disparo único — numa cadência cada toque é texto/IA próprio.
      if (!cadence && rule.videoId) {
        const video = await this.videoRepo.findOne({ where: { id: rule.videoId } });
        if (!video) {
          this.logger.warn(`[Followup] Regra ${rule.id} aponta pra vídeo inexistente (${rule.videoId}) — pulando`);
          continue;
        }
        this.rollVideoDayIfNeeded();
        if (this.videoSentToday >= videoLimit) {
          // Estourou o teto do dia — não marca followup_sent_at, tenta amanhã.
          this.logger.log(`[Followup] Teto diário de vídeo atingido (${videoLimit}) — ${lead.phone} fica pra amanhã`);
          continue;
        }

        if (sent > 0) {
          const waitMs = 10000 + Math.random() * 30000;
          await this.sleep(waitMs);
        }

        const caption = rule.videoCaptionOverride ?? video.caption ?? '';
        await this.sendFollowupVideo(lead, video.publicUrl, caption, video.name);
        this.videoSentToday++;
        sent++;
        continue;
      }

      let message: string;
      if (rule.mode === 'ai') {
        message = await this.generateAiFollowup(
          lead,
          cadence ? Math.max(1, cadence.step.delayMinutes) : rule.delayMinutes,
          rule,
          cadence ?? undefined,
        );
        if (!message) continue;
      } else {
        const text = cadence ? cadence.step.text : rule.text;
        if (!text?.trim()) continue;
        message = text;
      }

      // Espaçamento aleatório entre envios (5-10s) para reduzir risco de
      // bloqueio do número por disparo em rajada.
      if (sent > 0) {
        const waitMs = 10000 + Math.random() * 30000;
        await this.sleep(waitMs);
      }

      await this.sendFollowup(
        lead,
        message,
        cadence ? { nextStep: cadence.index + 1, nextAt: cadence.nextAt } : undefined,
      );
      sent++;
    }
    this.lastSentCount = sent;
  }

  /**
   * Disparo único de campanha: manda a mensagem da regra pra TODOS os leads que
   * casam com o filtro dela (raia/campanha/criativo/data), sem os portões do
   * cron normal — não importa se respondeu, se a última msg foi da IA, se está
   * com ai_paused, ou se já recebeu follow-up antes. É uma ação manual (botão
   * "Disparar agora"), não repete sozinho.
   */
  async broadcastNow(ruleId: string): Promise<{ sent: number; total: number }> {
    const rule = await this.rulesRepo.findOne({ where: { id: ruleId } });
    if (!rule) throw new Error('Regra não encontrada');

    const qb = this.leadsRepo
      .createQueryBuilder('lead')
      .select([
        'lead.id',
        'lead.name',
        'lead.phone',
        'lead.kanbanStage',
        'lead.utmCampaign',
        'lead.ctwaAdTitle',
        'lead.createdAt',
        'lead.waLastMessageAt',
        'lead.followupSentAt',
        'lead.aiContext',
        'lead.aiPaused',
        'lead.notes',
      ])
      .where('lead.agent_mode = :mode', { mode: 'sdr' });
    if (rule.kanbanStage) qb.andWhere('lead.kanban_stage = :stage', { stage: rule.kanbanStage });
    if (rule.utmCampaign) qb.andWhere('lead.utm_campaign = :campaign', { campaign: rule.utmCampaign });
    if (rule.adTitle) qb.andWhere('lead.ctwa_ad_title = :adTitle', { adTitle: rule.adTitle });
    if (rule.createdAfter) qb.andWhere('lead.created_at >= :createdAfter', { createdAfter: rule.createdAfter });

    const leads = await qb.getMany();
    const videoLimit = await this.getVideoLimit();

    let sent = 0;
    for (const lead of leads) {
      if (rule.videoId) {
        const video = await this.videoRepo.findOne({ where: { id: rule.videoId } });
        if (!video) {
          this.logger.warn(`[Broadcast] Regra ${rule.id} aponta pra vídeo inexistente (${rule.videoId}) — pulando`);
          continue;
        }
        this.rollVideoDayIfNeeded();
        if (this.videoSentToday >= videoLimit) {
          this.logger.log(`[Broadcast] Teto diário de vídeo atingido (${videoLimit}) — parando o disparo`);
          break;
        }
        if (sent > 0) await this.sleep(10000 + Math.random() * 30000);
        const caption = rule.videoCaptionOverride ?? video.caption ?? '';
        await this.sendFollowupVideo(lead, video.publicUrl, caption, video.name);
        this.videoSentToday++;
        sent++;
        continue;
      }

      // Disparo é sempre 1 mensagem só — numa regra de cadência usa o 1º toque
      // como conteúdo (o resto da sequência é papel do cron, não do botão).
      const firstStep = this.cadenceStepsOf(rule)?.[0];

      let message: string;
      if (rule.mode === 'ai') {
        message = await this.generateAiFollowup(
          lead,
          rule.delayMinutes,
          rule,
          firstStep ? { step: firstStep, index: 0, total: this.cadenceStepsOf(rule)!.length } : undefined,
        );
        if (!message) continue;
      } else {
        const text = firstStep ? firstStep.text : rule.text;
        if (!text?.trim()) continue;
        message = text;
      }

      if (sent > 0) await this.sleep(10000 + Math.random() * 30000);
      await this.sendFollowup(lead, message);
      sent++;
    }

    this.logger.log(`[Broadcast] Regra "${rule.name}": ${sent}/${leads.length} mensagens enviadas`);
    return { sent, total: leads.length };
  }

  // Data de hoje no fuso de Brasília ('YYYY-MM-DD').
  private brToday(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  }

  /**
   * Próxima ocorrência (timestamp em ms) do horário hour:minute em America/Sao_Paulo
   * a partir de um instante de referência (hoje, se ainda não passou; amanhã, se já
   * passou). Só usado para EXIBIÇÃO (dueAt no painel) — a decisão real de disparar
   * é a janela em isWithinSendWindow, não este cálculo. Brasil não tem horário de
   * verão desde 2019 — offset fixo UTC-3, dá pra calcular direto sem lib de timezone.
   */
  private nextSendTime(referenceMs: number, hour: number, minute: number): number {
    const { year, month, day } = this.brDateParts(new Date(referenceMs));
    let candidate = Date.UTC(year, month - 1, day, hour + 3, minute);
    if (candidate < referenceMs) candidate += 24 * 60 * 60 * 1000;
    return candidate;
  }

  /**
   * True quando o horário atual (America/Sao_Paulo) está dentro de uma janela curta
   * logo após hour:minute — ex. 13:00 a 13:10. Não compara contra quando o lead
   * ficou elegível (isso causava disparo imediato quando a elegibilidade era muito
   * antiga): compara contra o relógio de agora, então só dispara de fato perto do
   * horário configurado, todo dia, até o followupSentAt travar o reenvio.
   */
  private isWithinSendWindow(hour: number, minute: number, windowMinutes = 10): boolean {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
    const minutesNow = get('hour') * 60 + get('minute');
    const minutesTarget = hour * 60 + minute;
    return minutesNow >= minutesTarget && minutesNow < minutesTarget + windowMinutes;
  }

  private brDateParts(date: Date): { year: number; month: number; day: number } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
    return { year: get('year'), month: get('month'), day: get('day') };
  }

  private rollVideoDayIfNeeded(): void {
    const today = this.brToday();
    if (this.videoSentDate !== today) {
      this.videoSentDate = today;
      this.videoSentToday = 0;
    }
  }

  private async getVideoLimit(): Promise<number> {
    const value = await this.settings.get(VIDEO_LIMIT_KEY);
    return parseInt(value || String(DEFAULT_VIDEO_LIMIT), 10);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Status do follow-up para o painel de Configurações — agrupado por regra. */
  async getStatus() {
    await this.ensureRulesSeeded();
    const rules = await this.rulesRepo.find({ order: { createdAt: 'ASC' } });

    // Conexão WhatsApp (instância SDR)
    let whatsappConnected: boolean | null = null;
    let whatsappName: string | null = null;
    if (this.uazapiToken) {
      try {
        const res = await firstValueFrom(
          this.http.get(`${this.uazapiBaseUrl}/instance/status`, { headers: { token: this.uazapiToken } }),
        );
        const data = res.data as any;
        whatsappConnected = !!data?.status?.connected;
        whatsappName = data?.instance?.name ?? null;
      } catch {
        whatsappConnected = false;
      }
    }

    // Total real de follow-ups já enviados (sem limite — usado nos cards de resumo)
    const totalSent = await this.leadsRepo
      .createQueryBuilder('lead')
      .where('lead.agent_mode = :mode', { mode: 'sdr' })
      .andWhere('lead.followup_sent_at IS NOT NULL')
      .getCount();

    // Follow-ups já enviados (últimos 20, só para a lista exibida no painel)
    const sentLeads = await this.leadsRepo
      .createQueryBuilder('lead')
      .where('lead.agent_mode = :mode', { mode: 'sdr' })
      .andWhere('lead.followup_sent_at IS NOT NULL')
      .orderBy('lead.followup_sent_at', 'DESC')
      .take(20)
      .getMany();

    // Leads aguardando follow-up (última msg da IA, ainda não recebeu). Não filtra
    // ai_paused aqui — igual ao cron, quem está pausado só é descartado DEPOIS de
    // casar com uma regra (uma regra com ignoreAiPaused alcança esses leads
    // mesmo pausados; filtrar antes escondia esse público do painel mesmo quando
    // a regra estava configurada certinho pra atingi-los).
    const activeLeads = await this.leadsRepo
      .createQueryBuilder('lead')
      .where('lead.agent_mode = :mode', { mode: 'sdr' })
      .andWhere('lead.wa_last_message_at IS NOT NULL')
      // Mesma condição do cron: quem nunca recebeu + quem está no meio da cadência.
      .andWhere('(lead.followup_sent_at IS NULL OR lead.followup_next_at IS NOT NULL)')
      .orderBy('lead.wa_last_message_at', 'ASC')
      .getMany();

    const enabledRules = rules.filter((r) => r.enabled);
    const withRule = activeLeads
      .filter((l) => this.lastMessageWasFromAI(l))
      .map((l) => ({ lead: l, rule: this.matchRule(l, enabledRules) }));

    // Só entra na fila quem tem regra ativa de verdade te dando follow-up —
    // lead sem regra correspondente (ou pausado sem uma regra que ignore isso)
    // nunca vai disparar, não faz sentido poluir a lista de "aguardando".
    const noRuleCount = withRule.filter((x) => !x.rule || (x.lead.aiPaused && !x.rule.ignoreAiPaused)).length;

    // A partir daqui só quem tem chance real de disparar: tem regra E (não está
    // pausado OU a regra ignora pausa) — igual ao portão do cron de verdade.
    const eligible = withRule.filter((x) => x.rule && (!x.lead.aiPaused || x.rule.ignoreAiPaused)) as { lead: Lead; rule: FollowupRule }[];

    const dueAtMs = (l: Lead, rule: FollowupRule) => {
      // Numa cadência a espera é a do toque atual, não o delay único da regra.
      const steps = this.cadenceStepsOf(rule);
      const stepDelay = steps
        ? Math.max(1, (steps[Math.min(l.followupStep ?? 0, steps.length - 1)]).delayMinutes)
        : rule.delayMinutes;
      const eligibleAt = new Date(l.waLastMessageAt!).getTime() + stepDelay * 60 * 1000;
      if (rule.sendAtHour == null) return eligibleAt;
      // Referência = o que vier depois: se a elegibilidade é futura, calcula a
      // ocorrência a partir dela; se já passou (mesmo há dias), calcula a partir
      // de agora — senão o painel mostraria um horário "devido" no passado.
      return this.nextSendTime(Math.max(eligibleAt, Date.now()), rule.sendAtHour, rule.sendAtMinute ?? 0);
    };

    const waiting = eligible
      // Lead que já terminou a cadência inteira não está "aguardando" nada.
      .filter((x) => {
        const steps = this.cadenceStepsOf(x.rule);
        return !steps || (x.lead.followupStep ?? 0) < steps.length;
      })
      .sort((a, b) => dueAtMs(a.lead, a.rule) - dueAtMs(b.lead, b.rule))
      .map(({ lead: l, rule }) => {
        const steps = this.cadenceStepsOf(rule);
        return {
          id: l.id,
          name: l.name,
          phone: l.phone,
          kanbanStage: l.kanbanStage,
          utmCampaign: l.utmCampaign,
          adTitle: l.ctwaAdTitle,
          waLastMessageAt: l.waLastMessageAt,
          ruleId: rule.id,
          ruleName: rule.name,
          // Numa cadência mostra em que toque o lead está (1-based pra exibição).
          step: steps ? (l.followupStep ?? 0) + 1 : null,
          totalSteps: steps ? steps.length : null,
          dueAt: new Date(dueAtMs(l, rule)),
        };
      });

    return {
      rules,
      lastRunAt: this.lastRunAt,
      lastSentCount: this.lastSentCount,
      whatsappConnected,
      whatsappName,
      totalSent,
      noRuleCount,
      sent: sentLeads.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        kanbanStage: l.kanbanStage,
        followupSentAt: l.followupSentAt,
      })),
      waiting,
    };
  }

  private lastMessageWasFromAI(lead: Lead): boolean {
    const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    if (ctx.length === 0) return false;
    const last = ctx[ctx.length - 1];
    return last?.role === 'assistant';
  }

  private async generateAiFollowup(
    lead: Lead,
    delayMinutes: number,
    rule?: FollowupRule,
    cadence?: { step: CadenceStep; index: number; total: number },
  ): Promise<string> {
    try {
      const model = (await this.settings.get(SDR_MODEL_KEY)) || 'gpt-5.4-mini';

      const history: OpenAI.Chat.ChatCompletionMessageParam[] = (Array.isArray(lead.aiContext) ? lead.aiContext : []).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content ?? '',
      }));

      const tomBlock = `TOM (isso é o mais importante, não soa como isso hoje):
- Comece a mensagem com algo que quebre o gelo de forma empática (reconhecendo a correria, o sumiço, sem soar como cobrança) antes de ir pro conteúdo — nunca entre direto na pergunta fria.
- Escreva como alguém mandando um zap de verdade pra um conhecido, não como um script de vendas. Sem "Olá! Tudo bem?" genérico, sem parecer disparo automático.
- Trate por "vc", nunca "você" por extenso.
- Pode usar 1 emoji no máximo, só se soar natural — nunca fileira de emoji.
- Curta (1-3 frases). Sem parágrafo, sem lista, sem "!" em excesso.
- Nunca use frase de vendedor pressionando ("não perca essa oportunidade", "última chance") — o tom é de interesse genuíno na dor dela, não de cobrança.

Responda APENAS com o texto da mensagem, sem JSON, sem explicações, sem aspas ao redor.`;

      // Anotações que o operador escreveu no card. Nas raias mais quentes
      // ("em negociação", "já apresentado") é onde fica o combinado da última
      // conversa por ligação/áudio, que não existe no histórico do WhatsApp —
      // é o contexto mais atual que temos pra escrever um follow-up que faça
      // sentido pro lead. O lead nunca viu esse texto, então a IA não pode
      // citá-lo nem deixar transparecer que ele existe.
      const notesBlock = lead.notes?.trim()
        ? `ANOTAÇÕES INTERNAS sobre este lead (escritas por quem falou com ele; NÃO estão na conversa do WhatsApp e o lead NUNCA viu esse texto):
"""
${lead.notes.trim()}
"""
Trate isso como a informação mais atual sobre onde a negociação parou — retome o que ficou combinado aí, com naturalidade. Nunca mencione que existe uma anotação, nunca cite o texto: escreva como quem simplesmente lembra da conversa.`
        : '';

      // Toque de uma cadência: o objetivo do dia manda no conteúdo, e o texto
      // base da etapa entra como REFERÊNCIA (não é pra copiar — a IA reescreve
      // adaptando ao que já foi conversado com aquele lead).
      const cadenceBlock = cadence ? `\n\nIMPORTANTE — ISSO NÃO É QUALIFICAÇÃO, IGNORE O FLUXO/ORDEM DE PERGUNTAS ACIMA: o lead parou de responder e esta é a mensagem ${cadence.index + 1} de ${cadence.total} de uma sequência de follow-up. Não tente qualificar nem seguir a ordem de perguntas do prompt.

OBJETIVO DESTE TOQUE (só ele — não tente cumprir o objetivo dos outros dias):
${cadence.step.objective?.trim() || 'Reacender a conversa e fazer o lead voltar a responder.'}
${cadence.step.text?.trim() ? `
TEXTO BASE (referência de conteúdo e intenção — NÃO copie literalmente):
"""
${cadence.step.text.trim()}
"""
Reescreva com suas palavras, adaptando ao histórico deste lead. Se o texto base não fizer sentido pro que já foi conversado, mantenha o OBJETIVO acima e escreva do zero.` : ''}

Olhe o histórico e NÃO repita mensagem que você já mandou nos toques anteriores — nem o mesmo ângulo, nem a mesma pergunta com outras palavras.

${tomBlock}` : '';

      // Regra com prompt próprio (ex.: campanha de reativação de "qualificado") não
      // usa o DEFAULT_SDR_PROMPT nem a instrução de SPIN abaixo — o texto da regra
      // já é o system prompt completo, e o histórico continua indo junto pra IA
      // escrever a mensagem levando em conta o que já foi dito na conversa.
      if (rule?.promptOverride?.trim()) {
        // Nome vem do contato do WhatsApp (captado quando o lead entrou no grupo),
        // não foi perguntado na conversa — por isso não dá pra confiar que está no
        // histórico. Passa explícito pra IA poder personalizar com o nome certo.
        const nameNote = lead.name?.trim()
          ? `Nome do lead (puxado do WhatsApp dele, não foi perguntado na conversa): ${lead.name.trim()}. Pode usar o primeiro nome na mensagem pra personalizar, de forma natural — sem exagerar repetindo o nome.`
          : 'Este lead não tem nome salvo — não invente um nome, escreva sem se dirigir por nome.';

        const response = await this.openai.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: rule.promptOverride },
            { role: 'system', content: nameNote },
            ...(notesBlock ? [{ role: 'system' as const, content: notesBlock }] : []),
            ...history,
            {
              role: 'system',
              content: cadenceBlock
                || 'Gere agora a mensagem de reativação, considerando todo o histórico acima. Responda APENAS com o texto da mensagem, sem JSON, sem explicações, sem aspas ao redor.',
            },
          ],
          temperature: 0.8,
          max_completion_tokens: 150,
        });
        return response.choices[0].message.content?.trim() ?? '';
      }

      const basePrompt = await this.settings.getSdrPrompt();
      const hours = delayMinutes >= 60 ? `${Math.round(delayMinutes / 60)}h` : `${delayMinutes}min`;
      // A 1ª mensagem do lead é só o "clique" que abre a conversa (texto do
      // anúncio/CTWA ou "oi" genérico) — não conta como resposta à abertura da
      // Sofia. "Nunca respondeu" de verdade = nenhuma msg do lead DEPOIS da
      // 1ª resposta da IA. Sem esse recorte, todo lead tem pelo menos 1 'user'
      // (a msg que criou o lead) e o caso "sumiu logo após a abertura" nunca
      // era detectado (ver lead 61 9673-0268).
      const firstAssistantIdx = history.findIndex((m) => m.role === 'assistant');
      const leadNeverResponded = firstAssistantIdx === -1
        ? false
        : !history.slice(firstAssistantIdx + 1).some((m) => m.role === 'user');

      // Caso especial isolado (SEM o bloco SPIN abaixo): testado que, com o bloco
      // "COMO PENSAR" de SPIN presente, o modelo ignora a exceção e pula direto pra
      // uma pergunta de Problema/Implicação mesmo sem a qualificação básica ter
      // sido respondida (ver lead 4168 e 4289) — a lista de SPIN "puxa" o modelo
      // de volta pro padrão. Removendo o bloco inteiro nesse caso, sobra só a
      // instrução de retomar a pergunta inicial, sem concorrência.
      // Numa cadência quem manda é o objetivo do toque (escrito pelo operador),
      // não o raciocínio automático de SPIN/retomada — por isso substitui os dois.
      const followupInstruction = cadenceBlock ? cadenceBlock : leadNeverResponded
        ? `\n\nIMPORTANTE — ISSO NÃO É QUALIFICAÇÃO: o lead nunca respondeu NADA nesta conversa, só recebeu sua abertura há ${hours}. Você não sabe se ele vende cabelo/mega hair, nem nada sobre o negócio dele.

PROIBIDO nesta mensagem: perguntar sobre perder vendas, mensagens escapando, custo de não responder, ou qualquer variação de pergunta de Problema/Implicação/Necessidade — isso pressupõe uma qualificação que não existe ainda.

SUA ÚNICA MISSÃO: quebrar o gelo com empatia (reconhecendo a correria, o sumiço, sem soar como cobrança) e retomar a MESMA pergunta da abertura (se ele vende cabelo/mega hair ou trabalha com colocação/manutenção), só que com outras palavras.

${tomBlock}`
        : `\n\nIMPORTANTE — ISSO NÃO É QUALIFICAÇÃO, IGNORE O FLUXO/ORDEM DE PERGUNTAS ACIMA: mesmo que ainda falte nome, "vende cabelo", "investe em anúncio" ou Instagram no histórico, NÃO pergunte isso agora e NÃO siga a ordem do fluxo de qualificação. Essa tarefa é outra: o lead sumiu no meio da conversa e sua única missão é fazer ele voltar a responder.

AGORA: o lead não respondeu há ${hours}. Gere UMA mensagem de follow-up curta pra reacender essa conversa específica — não um follow-up genérico e não uma pergunta de qualificação.

COMO PENSAR (técnica SPIN Selling, aplicada ao que já foi dito):
1. Releia o histórico acima e identifique em que ponto ele parou: você já sabe a Situação dele (o que ele vende, se anuncia)? Já tocou no Problema (dificuldade real que ele tem hoje)? Já fez alguma pergunta de Implicação (o que isso custa pra ele continuar assim)? Já mostrou o ganho de resolver (Necessidade-payoff)?
2. Escolha UMA coisa pra avançar a partir daí — nunca repita uma pergunta que ele já respondeu.
   - Se ele nunca falou de um problema/dor real: puxe isso com uma pergunta leve (ex: quantos clientes ele acha que perde por demorar a responder).
   - Se ele já falou do problema mas você nunca conectou ao custo disso: faça uma pergunta de implicação (o que isso representa em vendas perdidas, tempo, etc).
   - Se ele já entende o problema mas nunca ouviu o que ganha resolvendo: mostre o ganho de forma concreta e pergunte se faz sentido pra ele.
   - Se a conversa parou logo depois de uma pergunta sua sem resposta: não repita a mesma pergunta com outras palavras — traga uma entrada diferente pro assunto.

${tomBlock}`;

      // A instrução de follow-up vai como a ÚLTIMA mensagem (depois do histórico), não
      // colada no system prompt lá no início — testado que, colada no início, o modelo
      // ignora e volta pro fluxo de qualificação padrão (instrução fica "afogada" pelo
      // prompt longo). Perto do ponto de geração, a instrução é seguida de verdade.
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: basePrompt },
          ...(notesBlock ? [{ role: 'system' as const, content: notesBlock }] : []),
          ...history,
          { role: 'system', content: followupInstruction },
        ],
        temperature: 0.8,
        max_completion_tokens: 150,
      });

      return response.choices[0].message.content?.trim() ?? '';
    } catch (err: any) {
      this.logger.error(`[Followup] Erro ao gerar follow-up para ${lead.phone}: ${err.message}`);
      return '';
    }
  }

  private async sendFollowup(lead: Lead, text: string, cadence?: { nextStep: number; nextAt: Date | null }) {
    if (!this.uazapiToken) {
      this.logger.warn(`[Followup] Token SDR não configurado — follow-up não enviado para ${lead.phone}`);
      return;
    }

    try {
      const phone = lead.phone.startsWith('55') ? lead.phone : `55${lead.phone}`;
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/send/text`,
          { number: phone, text },
          { headers: { token: this.uazapiToken } },
        ),
      );

      // Só marca como enviado se o WhatsApp aceitou. Registra a mensagem no
      // histórico para aparecer na conversa e a IA manter o contexto.
      const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : [];
      await this.leadsRepo.update(lead.id, {
        followupSentAt: new Date(),
        // Avança a cadência: nextAt null = era o último toque, o lead sai da
        // sequência (e da consulta do cron) até responder ou ser resetado.
        ...(cadence ? { followupStep: cadence.nextStep, followupNextAt: cadence.nextAt } : {}),
        aiContext: [...ctx, { role: 'assistant', content: text, timestamp: new Date().toISOString() }],
        waLastMessageAt: new Date(),
      });

      const fresh = await this.leadsRepo.findOne({ where: { id: lead.id } });
      if (fresh) this.realtime.emitLeadUpdated(fresh);

      const tag = cadence ? ` [toque ${cadence.nextStep}]` : '';
      this.logger.log(`[Followup]${tag} Enviado para ${lead.phone}: "${text.slice(0, 60)}..."`);
    } catch (err: any) {
      this.logger.error(`[Followup] Erro ao enviar para ${lead.phone}: ${err.message}`);
    }
  }

  private async sendFollowupVideo(lead: Lead, videoUrl: string, caption: string, videoName: string) {
    if (!this.uazapiToken) {
      this.logger.warn(`[Followup] Token SDR não configurado — vídeo não enviado para ${lead.phone}`);
      return;
    }

    try {
      const phone = lead.phone.startsWith('55') ? lead.phone : `55${lead.phone}`;
      // Padrão do efraim.controller: /send/media com file=URL pública, text=legenda.
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/send/media`,
          { number: phone, file: videoUrl, type: 'video', text: caption, delay: 1000 },
          { headers: { token: this.uazapiToken } },
        ),
      );

      // Marca como enviado só se o WhatsApp aceitou. O `content` fica com um marcador
      // (pra IA saber que já mandou vídeo e não reoferecer) e os campos mediaType/
      // mediaUrl deixam o CRM renderizar o player de vídeo na conversa (KanbanLeads.jsx).
      const marker = `[sistema: vídeo "${videoName}" enviado no follow-up]${caption ? ` legenda: ${caption}` : ''}`;
      const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : [];
      await this.leadsRepo.update(lead.id, {
        followupSentAt: new Date(),
        aiContext: [...ctx, {
          role: 'assistant',
          content: marker,
          caption,
          mediaType: 'video',
          mediaUrl: videoUrl,
          filename: videoName,
          timestamp: new Date().toISOString(),
        }],
        waLastMessageAt: new Date(),
      });

      const fresh = await this.leadsRepo.findOne({ where: { id: lead.id } });
      if (fresh) this.realtime.emitLeadUpdated(fresh);

      this.logger.log(`[Followup] Vídeo "${videoName}" enviado para ${lead.phone}`);
    } catch (err: any) {
      this.logger.error(`[Followup] Erro ao enviar vídeo para ${lead.phone}: ${err.message}`);
    }
  }
}
