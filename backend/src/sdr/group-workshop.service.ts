import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Lead } from '../common/entities/lead.entity';
import { SettingsService } from '../settings/settings.service';
import { SDR_MODEL_KEY, SDR_DEFAULT_MODEL } from './sdr.prompt';

const JOIN_TAG = 'entrou_no_grupo';

// Tela "Entraram no Grupo" (menu Funil) — pra Fagner/Alex saberem com quem vão
// falar na live antes de vender o plano de R$410. Além dos campos estruturados
// que a Sofia já coleta (mensagensPorDia, vendeCabelo etc — nem sempre
// preenchidos, muitos leads do grupo ainda estão em "novo" sem qualificação
// completa), lê a conversa (ai_context) com IA e extrai dores/volume/contexto
// mencionados em texto livre. Resultado fica em cache (conversation_insights)
// — só recalcula quando o operador pede, não a cada carregamento da tela.
@Injectable()
export class GroupWorkshopService {
  private readonly logger = new Logger(GroupWorkshopService.name);
  private readonly openai: OpenAI;
  private readonly defaultModel: string;

  constructor(
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    private readonly settings: SettingsService,
    config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    this.defaultModel = config.get('SDR_OPENAI_MODEL') || SDR_DEFAULT_MODEL;
  }

  async listLeads(): Promise<Lead[]> {
    return this.leadsRepo
      .createQueryBuilder('lead')
      .where("lead.tags @> :tag::jsonb", { tag: JSON.stringify([JOIN_TAG]) })
      .orderBy('lead.created_at', 'DESC')
      .getMany();
  }

  async analyzeLead(leadId: string): Promise<Lead> {
    const lead = await this.leadsRepo.findOne({ where: { id: leadId } });
    if (!lead) throw new Error('Lead não encontrado');

    const history: any[] = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    if (history.length === 0) {
      const insights = { painPoints: null, messagesPerDayMentioned: null, otherNotes: 'Sem histórico de conversa.', generatedAt: new Date().toISOString() };
      await this.leadsRepo.update(leadId, { conversationInsights: insights });
      return { ...lead, conversationInsights: insights };
    }

    const transcript = history
      .map((m) => `${m.role === 'assistant' ? 'Vendedora' : 'Lead'}: ${m.content}`)
      .join('\n');

    const model = (await this.settings.get(SDR_MODEL_KEY)) || this.defaultModel;

    const systemPrompt = `Você é um analista de vendas que lê conversas de WhatsApp entre uma vendedora de cabelo/mega hair (Alex, via assistente Sofia) e uma cliente que TAMBÉM vende mega hair (é uma revendedora, não consumidora final).

O objetivo é preparar a vendedora pra uma ligação/live onde ela vai OFERECER um plano de R$410/mês de uma IA de atendimento automático via WhatsApp (que qualifica lead, responde 24h, tira a revendedora de ter que responder tudo manualmente).

Leia a conversa abaixo e responda em JSON com este formato exato:
{
  "painPoints": "resumo curto (1-2 frases) das dores/dificuldades que a pessoa mencionou na conversa — ex: demora pra responder, perde venda por não dar conta do volume, atende sozinha, não sabe precificar, etc. null se a conversa não trouxe nada sobre dificuldades.",
  "messagesPerDayMentioned": <número inteiro se ela mencionou quantas mensagens/dia recebe (ex: 'recebo umas 30 por dia'), senão null>,
  "otherNotes": "outras informações relevantes pra venda: já usa alguma ferramenta/atendente, tamanho do negócio, se demonstrou interesse ou objeção de preço, nível de urgência, se já vende há tempo, etc. null se não há nada relevante além do já capturado."
}

Responda SOMENTE o JSON, nada além disso. Nunca invente informação que não está na conversa — use null quando não souber.`;

    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript },
        ],
        temperature: 0.2,
        max_completion_tokens: 500,
        response_format: { type: 'json_object' },
      });

      let raw = response.choices[0].message.content?.trim() ?? '{}';
      raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      const insights = {
        painPoints: typeof parsed.painPoints === 'string' ? parsed.painPoints : null,
        messagesPerDayMentioned: Number.isFinite(parsed.messagesPerDayMentioned) ? parsed.messagesPerDayMentioned : null,
        otherNotes: typeof parsed.otherNotes === 'string' ? parsed.otherNotes : null,
        generatedAt: new Date().toISOString(),
      };

      await this.leadsRepo.update(leadId, { conversationInsights: insights });
      return { ...lead, conversationInsights: insights };
    } catch (err: any) {
      this.logger.error(`Falha ao analisar conversa do lead ${leadId}: ${err.message}`);
      throw err;
    }
  }

  /** Roda a análise pra todos os leads do grupo que ainda não têm resumo (ou força refresh de todos, se forceAll=true). */
  async analyzeAll(forceAll = false): Promise<{ analyzed: number; total: number; failed: string[] }> {
    const leads = await this.listLeads();
    const targets = forceAll ? leads : leads.filter((l) => !l.conversationInsights);
    const failed: string[] = [];
    let analyzed = 0;
    for (const lead of targets) {
      try {
        await this.analyzeLead(lead.id);
        analyzed++;
      } catch {
        failed.push(lead.id);
      }
    }
    return { analyzed, total: leads.length, failed };
  }
}
