import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Lead, KanbanStage, LeadTemperature } from '../common/entities/lead.entity';
import { SettingsService } from '../settings/settings.service';
import { SDR_PROMPT_KEY, DEFAULT_SDR_PROMPT, SDR_JSON_FORMAT, SDR_MODEL_KEY, SDR_DEFAULT_MODEL } from './sdr.prompt';

export type SdrStage = 'abertura' | 'qualificacao' | 'quente' | 'frio' | 'perdido' | 'encerrado';

export interface SdrResponse {
  reply: string;
  stage: SdrStage;
  temperature: LeadTemperature;
  handoff: boolean;
  success: boolean;
}

const REVENUE_LABELS: Record<string, string> = {
  'ate-10k': 'até R$ 10 mil/mês',
  '10k-30k': 'entre R$ 10 e 30 mil/mês',
  '30k-100k': 'entre R$ 30 e 100 mil/mês',
  '100k-300k': 'entre R$ 100 e 300 mil/mês',
  'acima-300k': 'acima de R$ 300 mil/mês',
};

function buildLeadContext(lead?: Lead | null): string {
  const lines: string[] = [];
  if (lead?.name) lines.push(`- Nome: ${lead.name}`);
  if (lead?.revenueRange) lines.push(`- Faturamento: ${REVENUE_LABELS[lead.revenueRange] || lead.revenueRange}`);
  if (lead?.aiInsight?.niche) lines.push(`- Nicho: ${lead.aiInsight.niche}`);
  if (lead?.instagram) lines.push(`- Instagram: @${lead.instagram}`);
  if (lead?.aiInsight?.selling_angle) lines.push(`- Gargalo identificado: ${lead.aiInsight.selling_angle}`);
  return lines.length > 0 ? `\nCONTEXTO DO LEAD (use para não perguntar o que já foi dito):\n${lines.join('\n')}` : '';
}

// Compõe o prompt final: persona (editável) + contexto do lead + formato JSON obrigatório
function buildSystemPrompt(basePrompt: string, lead?: Lead | null): string {
  return `${basePrompt}\n${buildLeadContext(lead)}\n\n${SDR_JSON_FORMAT}`;
}

/**
 * Mapeia o estágio + temperatura da conversa para a raia do Kanban.
 * `current` é a raia atual (mantida em casos ambíguos).
 */
export function deriveKanbanStage(
  stage: SdrStage,
  temperature: LeadTemperature | undefined,
  isMql: boolean,
  status: string | undefined,
  current: KanbanStage,
): KanbanStage {
  if (status === 'perdido' || stage === 'perdido') return 'perdido';
  if (stage === 'abertura') return 'novo';
  if (stage === 'quente' || temperature === 'quente' || isMql) return 'qualificado';
  if (stage === 'frio' || temperature === 'frio' || temperature === 'morno') return 'nao-qualificado';
  return current || 'novo';
}

@Injectable()
export class SdrService {
  private readonly logger = new Logger(SdrService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    this.model = config.get('SDR_OPENAI_MODEL') || 'gpt-5.4-mini';
  }

  async processMessage(lead: Lead, incomingText: string): Promise<SdrResponse> {
    // Sanitiza roles inválidos de versões anteriores (ex.: 'lead', 'gabi')
    const rawHistory: any[] = (lead.aiContext as any[]) ?? [];
    const history: OpenAI.Chat.ChatCompletionMessageParam[] = rawHistory.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content ?? '',
    }));

    // Carrega o prompt e o modelo configurados em Configurações
    const basePrompt = (await this.settings.get(SDR_PROMPT_KEY)) || DEFAULT_SDR_PROMPT;
    const model = (await this.settings.get(SDR_MODEL_KEY)) || this.model;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(basePrompt, lead) },
      ...history,
      { role: 'user', content: incomingText },
    ];

    try {
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

      const parsed = JSON.parse(jsonMatch[0]) as SdrResponse;
      parsed.success = true;
      parsed.handoff = Boolean(parsed.handoff);

      this.logger.log(`SDR respondeu [stage=${parsed.stage}, temp=${parsed.temperature}, handoff=${parsed.handoff}]: ${parsed.reply}`);
      return parsed;
    } catch (err: any) {
      this.logger.error(`Erro no SDR: ${err.message}`);
      return {
        reply: '',
        stage: 'qualificacao',
        temperature: 'morno',
        handoff: false,
        success: false,
      };
    }
  }

  buildUpdatedContext(
    lead: Lead | null,
    incomingText: string,
    reply: string,
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const history: OpenAI.Chat.ChatCompletionMessageParam[] = (lead?.aiContext as any[]) ?? [];
    return [
      ...history,
      { role: 'user', content: incomingText },
      { role: 'assistant', content: reply },
    ];
  }
}
