import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, LessThan } from 'typeorm';
import OpenAI from 'openai';
import { Lead } from '../common/entities/lead.entity';
import { SettingsService } from '../settings/settings.service';
import { SDR_PROMPT_KEY, DEFAULT_SDR_PROMPT, SDR_MODEL_KEY } from './sdr.prompt';

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

  constructor(
    @InjectRepository(Lead)
    private leadsRepo: Repository<Lead>,
    private settings: SettingsService,
    private http: HttpService,
    private config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    this.uazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || '';
    this.uazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
  }

  @Cron('*/5 * * * *')
  async checkFollowups() {
    const enabled = (await this.settings.get(FOLLOWUP_ENABLED_KEY)) === 'true';
    if (!enabled) return;

    const delayMinutes = parseInt((await this.settings.get(FOLLOWUP_DELAY_KEY)) || '60', 10);
    const mode = (await this.settings.get(FOLLOWUP_MODE_KEY)) || 'manual';
    const manualText = await this.settings.get(FOLLOWUP_TEXT_KEY);

    if (mode === 'manual' && !manualText) {
      this.logger.warn('[Followup] Modo manual sem texto configurado — ignorando');
      return;
    }

    const cutoff = new Date(Date.now() - delayMinutes * 60 * 1000);

    // Leads SDR ativos, com última atividade antes do cutoff
    const candidates = await this.leadsRepo
      .createQueryBuilder('lead')
      .where('lead.agent_mode = :mode', { mode: 'sdr' })
      .andWhere('lead.ai_paused = false')
      .andWhere("lead.wa_stage != 'encerrado' OR lead.wa_stage IS NULL")
      .andWhere('lead.wa_last_message_at IS NOT NULL')
      .andWhere('lead.wa_last_message_at < :cutoff', { cutoff })
      .andWhere('(lead.followup_sent_at IS NULL OR lead.followup_sent_at < :cutoff)', { cutoff })
      .getMany();

    for (const lead of candidates) {
      if (!this.lastMessageWasFromAI(lead)) continue;

      let message: string;
      if (mode === 'ai') {
        message = await this.generateAiFollowup(lead, delayMinutes);
        if (!message) continue;
      } else {
        message = manualText!;
      }

      await this.sendFollowup(lead, message);
    }
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
    try {
      await this.leadsRepo.update(lead.id, { followupSentAt: new Date() });

      if (!this.uazapiToken) {
        this.logger.warn(`[Followup] Token SDR não configurado — follow-up gerado mas não enviado para ${lead.phone}`);
        return;
      }

      const phone = lead.phone.startsWith('55') ? lead.phone : `55${lead.phone}`;
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/send/text`,
          { number: phone, text },
          { headers: { token: this.uazapiToken } },
        ),
      );

      this.logger.log(`[Followup] Enviado para ${lead.phone}: "${text.slice(0, 60)}..."`);
    } catch (err: any) {
      this.logger.error(`[Followup] Erro ao enviar para ${lead.phone}: ${err.message}`);
    }
  }
}
