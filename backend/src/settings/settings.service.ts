import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Setting } from './setting.entity';
import { SDR_PROMPT_KEY, DEFAULT_SDR_PROMPT, SDR_JSON_FORMAT, SDR_MODEL_KEY, SDR_DEFAULT_MODEL } from '../sdr/sdr.prompt';

@Injectable()
export class SettingsService {
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    @InjectRepository(Setting)
    private settingsRepo: Repository<Setting>,
    private config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    this.model = config.get('SDR_OPENAI_MODEL') || 'gpt-5.4-mini';
  }

  async get(key: string): Promise<string | null> {
    const row = await this.settingsRepo.findOne({ where: { key } });
    return row?.value ?? null;
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
      handoff: Boolean(parsed.handoff),
    };
  }
}
