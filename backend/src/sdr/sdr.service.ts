import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Lead, KanbanStage, LeadTemperature } from '../common/entities/lead.entity';
import { SettingsService } from '../settings/settings.service';
import { SDR_JSON_FORMAT, SDR_MODEL_KEY } from './sdr.prompt';

export type SdrStage = 'abertura' | 'qualificacao' | 'quente' | 'frio' | 'perdido' | 'encerrado';

export interface SdrResponse {
  reply: string;
  stage: SdrStage;
  temperature: LeadTemperature;
  nome?: string | null;
  vendeCabelo?: boolean | null;
  mensagensPorDia?: number | null;
  instagram?: string | null;
  semInstagram?: boolean | null;
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
 * Mapeia a resposta de qualificação (vende cabelo) + estágio da conversa pra
 * raia do Kanban. `vendeCabelo` é a "verdade" da qualificação: true → qualificado
 * direto (MQL), false → não qualificado. Investir em anúncio NÃO muda de raia,
 * só soma a tag "mql_premium" (ver sdr.controller.ts).
 */
export function deriveKanbanStage(
  vendeCabelo: boolean | null | undefined,
  stage: SdrStage,
  status: string | undefined,
): KanbanStage {
  if (status === 'perdido' || stage === 'perdido') return 'perdido';
  if (vendeCabelo === false) return 'nao-qualificado';
  if (vendeCabelo === true) return 'qualificado';
  if (stage === 'abertura') return 'novo';
  return 'atendimento';
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
    const basePrompt = await this.settings.getSdrPrompt();
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
        // 900 (não 300): gpt-5.4-mini é um modelo de raciocínio — os tokens de
        // "pensamento" saem do mesmo budget de max_completion_tokens. Com 300,
        // conversas mais longas (mais contexto = mais raciocínio) estouravam o
        // budget antes de escrever o JSON de verdade, e o modo json_object
        // devolvia um objeto vazio/truncado em vez de erro (ver validação abaixo).
        max_completion_tokens: 900,
        response_format: { type: 'json_object' },
      });

      let raw = response.choices[0].message.content?.trim() ?? '';
      raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Resposta sem JSON válido');

      const parsed = JSON.parse(jsonMatch[0]) as SdrResponse;

      // Defesa contra "\n" literal (2 caracteres: barra + n) no reply — visto ao
      // combinar uma reação com o texto fixo de transferência (multi-linha): o
      // modelo às vezes escapa errado ao montar o JSON e o "\n" sobrevive como
      // texto em vez de virar quebra de linha real no parse. Não afeta quebras
      // reais (já viram \n de verdade no parse, esse regex não bate nelas).
      if (typeof parsed.reply === 'string') parsed.reply = parsed.reply.replace(/\\n/g, '\n');

      // Defesa contra JSON "válido" mas vazio/incompleto (ex.: modelo estourou o
      // budget de tokens em raciocínio e devolveu {} pro response_format ainda
      // assim aceitar). Sem isso, a conversa morre silenciosamente: reply vira
      // undefined, o controller não manda nada e nem tenta de novo (só reage a
      // success=false). Tratando como erro aqui, o retry único do controller entra em ação.
      if (!parsed.reply || typeof parsed.reply !== 'string' || !parsed.stage) {
        throw new Error(`JSON incompleto da IA (reply=${JSON.stringify(parsed.reply)}, stage=${parsed.stage})`);
      }

      parsed.success = true;

      this.logger.log(`SDR respondeu [stage=${parsed.stage}, temp=${parsed.temperature}, vendeCabelo=${parsed.vendeCabelo}, mensagensPorDia=${parsed.mensagensPorDia}]: ${parsed.reply}`);
      return parsed;
    } catch (err: any) {
      this.logger.error(`Erro no SDR: ${err.message}`);
      return {
        reply: '',
        stage: 'qualificacao',
        temperature: 'morno',
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
