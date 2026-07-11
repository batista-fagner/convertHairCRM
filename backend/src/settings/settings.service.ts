import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Setting } from './setting.entity';
import { Lead } from '../common/entities/lead.entity';
import { SDR_PROMPT_KEY, DEFAULT_SDR_PROMPT, SDR_JSON_FORMAT, SDR_MODEL_KEY, SDR_DEFAULT_MODEL } from '../sdr/sdr.prompt';

@Injectable()
export class SettingsService {
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    @InjectRepository(Setting)
    private settingsRepo: Repository<Setting>,
    @InjectRepository(Lead)
    private leadsRepo: Repository<Lead>,
    private config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    this.model = config.get('SDR_OPENAI_MODEL') || 'gpt-5.4-mini';
  }

  /**
   * Limpa o followup_sent_at dos leads SDR ativos para permitir um novo ciclo
   * de follow-up. Chamado quando o operador reconfigura (ex.: muda 1h → 12h),
   * permitindo um segundo follow-up para quem ainda não respondeu.
   */
  async resetFollowupFlags(): Promise<number> {
    const res = await this.leadsRepo
      .createQueryBuilder()
      .update(Lead)
      .set({ followupSentAt: null })
      .where('agent_mode = :mode', { mode: 'sdr' })
      .andWhere('ai_paused = false')
      .andWhere("wa_stage != 'encerrado'")
      .andWhere('followup_sent_at IS NOT NULL')
      .execute();
    return res.affected ?? 0;
  }

  async get(key: string): Promise<string | null> {
    const row = await this.settingsRepo.findOne({ where: { key } });
    return row?.value ?? null;
  }

  async getRow(key: string): Promise<Setting | null> {
    return this.settingsRepo.findOne({ where: { key } });
  }

  async set(key: string, value: string): Promise<Setting> {
    await this.settingsRepo.upsert({ key, value }, ['key']);
    return this.settingsRepo.findOneOrFail({ where: { key } });
  }

  async simulate(message: string, history: { role: 'user' | 'assistant'; content: string }[]) {
    const basePrompt = (await this.get(SDR_PROMPT_KEY)) || DEFAULT_SDR_PROMPT;
    const model = (await this.get(SDR_MODEL_KEY)) || this.model;
    const systemPrompt = `${basePrompt}\n\n${SDR_JSON_FORMAT}`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message },
    ];

    const response = await this.openai.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_completion_tokens: 300,
      response_format: { type: 'json_object' },
    });

    let raw = response.choices[0].message.content?.trim() ?? '';
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Resposta sem JSON válido');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      reply: parsed.reply ?? '',
      stage: parsed.stage ?? 'qualificacao',
      temperature: parsed.temperature ?? 'morno',
      nome: parsed.nome ?? null,
      vendeCabelo: parsed.vendeCabelo ?? null,
      investeAnuncio: parsed.investeAnuncio ?? null,
      instagram: parsed.instagram ?? null,
      semInstagram: parsed.semInstagram ?? null,
    };
  }
}
