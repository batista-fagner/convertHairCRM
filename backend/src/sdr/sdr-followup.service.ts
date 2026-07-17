import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { Lead } from '../common/entities/lead.entity';
import { FollowupRule } from '../common/entities/followup-rule.entity';
import { SettingsService } from '../settings/settings.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SDR_PROMPT_KEY, DEFAULT_SDR_PROMPT, SDR_MODEL_KEY } from './sdr.prompt';

// Chaves da config global antiga (1 regra só) — usadas só pra migração automática
// pra 1ª FollowupRule na primeira vez que o sistema roda com a tabela vazia.
const FOLLOWUP_ENABLED_KEY = 'sdr_followup_enabled';
const FOLLOWUP_DELAY_KEY = 'sdr_followup_delay_minutes';
const FOLLOWUP_MODE_KEY = 'sdr_followup_mode';
const FOLLOWUP_TEXT_KEY = 'sdr_followup_text';

export { FOLLOWUP_ENABLED_KEY, FOLLOWUP_DELAY_KEY, FOLLOWUP_MODE_KEY, FOLLOWUP_TEXT_KEY };

@Injectable()
export class SdrFollowupService {
  private readonly logger = new Logger(SdrFollowupService.name);
  private readonly openai: OpenAI;
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;
  private rulesSeeded = false;

  // Telemetria do cron (exposta em getStatus para o painel)
  private lastRunAt: Date | null = null;
  private lastSentCount = 0;

  constructor(
    @InjectRepository(Lead)
    private leadsRepo: Repository<Lead>,
    @InjectRepository(FollowupRule)
    private rulesRepo: Repository<FollowupRule>,
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

  /** Regra mais específica que casa com o lead (raia + campanha > só uma > coringa). Undefined se nenhuma casar. */
  private matchRule(lead: Lead, rules: FollowupRule[]): FollowupRule | undefined {
    let best: FollowupRule | undefined;
    let bestScore = -1;
    for (const rule of rules) {
      const stageOk = rule.kanbanStage == null || rule.kanbanStage === lead.kanbanStage;
      const campaignOk = rule.utmCampaign == null || rule.utmCampaign === lead.utmCampaign;
      if (!stageOk || !campaignOk) continue;

      const score = (rule.kanbanStage != null ? 1 : 0) + (rule.utmCampaign != null ? 1 : 0);
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

  @Cron('*/5 * * * *')
  async checkFollowups() {
    this.lastRunAt = new Date();
    await this.ensureRulesSeeded();

    const rules = await this.rulesRepo.find({ where: { enabled: true } });
    if (rules.length === 0) return;

    // Candidatos: IA ativa + nunca recebeu follow-up (followup_sent_at IS NULL garante
    // 1x; reseta quando o lead responde ou quando o operador reconfigura). O delay é
    // por regra, então aqui não filtra por tempo ainda — isso é feito por lead abaixo.
    const candidates = await this.leadsRepo
      .createQueryBuilder('lead')
      .where('lead.agent_mode = :mode', { mode: 'sdr' })
      .andWhere('lead.ai_paused = false')
      .andWhere('lead.wa_stage != :encerrado', { encerrado: 'encerrado' })
      .andWhere('lead.wa_last_message_at IS NOT NULL')
      .andWhere('lead.followup_sent_at IS NULL')
      .getMany();

    let sent = 0;
    for (const lead of candidates) {
      if (!this.lastMessageWasFromAI(lead)) continue;

      const rule = this.matchRule(lead, rules);
      if (!rule) continue;

      const cutoff = Date.now() - rule.delayMinutes * 60 * 1000;
      if (new Date(lead.waLastMessageAt!).getTime() > cutoff) continue;

      let message: string;
      if (rule.mode === 'ai') {
        message = await this.generateAiFollowup(lead, rule.delayMinutes);
        if (!message) continue;
      } else {
        if (!rule.text) continue;
        message = rule.text;
      }

      // Espaçamento aleatório entre envios (5-10s) para reduzir risco de
      // bloqueio do número por disparo em rajada.
      if (sent > 0) {
        const waitMs = 5000 + Math.random() * 5000;
        await this.sleep(waitMs);
      }

      await this.sendFollowup(lead, message);
      sent++;
    }
    this.lastSentCount = sent;
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

    // Leads aguardando follow-up (IA ativa, última msg da IA, ainda não recebeu)
    const activeLeads = await this.leadsRepo
      .createQueryBuilder('lead')
      .where('lead.agent_mode = :mode', { mode: 'sdr' })
      .andWhere('lead.ai_paused = false')
      .andWhere('lead.wa_stage != :encerrado', { encerrado: 'encerrado' })
      .andWhere('lead.wa_last_message_at IS NOT NULL')
      .andWhere('lead.followup_sent_at IS NULL')
      .orderBy('lead.wa_last_message_at', 'ASC')
      .getMany();

    const enabledRules = rules.filter((r) => r.enabled);
    const waiting = activeLeads
      .filter((l) => this.lastMessageWasFromAI(l))
      .map((l) => {
        const rule = this.matchRule(l, enabledRules);
        return {
          id: l.id,
          name: l.name,
          phone: l.phone,
          kanbanStage: l.kanbanStage,
          utmCampaign: l.utmCampaign,
          waLastMessageAt: l.waLastMessageAt,
          ruleId: rule?.id ?? null,
          ruleName: rule?.name ?? null,
          dueAt: rule ? new Date(new Date(l.waLastMessageAt!).getTime() + rule.delayMinutes * 60 * 1000) : null,
        };
      });

    return {
      rules,
      lastRunAt: this.lastRunAt,
      lastSentCount: this.lastSentCount,
      whatsappConnected,
      whatsappName,
      totalSent,
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

  private async generateAiFollowup(lead: Lead, delayMinutes: number): Promise<string> {
    try {
      const basePrompt = (await this.settings.get(SDR_PROMPT_KEY)) || DEFAULT_SDR_PROMPT;
      const model = (await this.settings.get(SDR_MODEL_KEY)) || 'gpt-5.4-mini';

      const history: OpenAI.Chat.ChatCompletionMessageParam[] = (Array.isArray(lead.aiContext) ? lead.aiContext : []).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content ?? '',
      }));

      const hours = delayMinutes >= 60 ? `${Math.round(delayMinutes / 60)}h` : `${delayMinutes}min`;
      const followupInstruction = `\n\nAGORA: O lead não respondeu há ${hours}. Gere uma mensagem de follow-up curta, natural e sem pressão. Reacenda a conversa de onde parou. Responda APENAS com o texto da mensagem, sem JSON, sem explicações.`;

      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: basePrompt + followupInstruction },
          ...history,
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

  private async sendFollowup(lead: Lead, text: string) {
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
        aiContext: [...ctx, { role: 'assistant', content: text }],
        waLastMessageAt: new Date(),
      });

      const fresh = await this.leadsRepo.findOne({ where: { id: lead.id } });
      if (fresh) this.realtime.emitLeadUpdated(fresh);

      this.logger.log(`[Followup] Enviado para ${lead.phone}: "${text.slice(0, 60)}..."`);
    } catch (err: any) {
      this.logger.error(`[Followup] Erro ao enviar para ${lead.phone}: ${err.message}`);
    }
  }
}
