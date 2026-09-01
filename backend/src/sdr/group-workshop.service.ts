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
      .orderBy('lead.group_joined_at', 'DESC', 'NULLS LAST')
      .addOrderBy('lead.created_at', 'DESC')
      .getMany();
  }

  async analyzeLead(leadId: string): Promise<Lead> {
    const lead = await this.leadsRepo.findOne({ where: { id: leadId } });
    if (!lead) throw new Error('Lead não encontrado');

    // Lead veio de tráfego pago (respondeu o quiz) — analisa as respostas do
    // quiz em vez da conversa (esses leads têm aiPaused=true e normalmente
    // ZERO histórico de chat, já que a Sofia não conversa com eles).
    const fromQuiz = Boolean(lead.quizSlug) && Array.isArray(lead.quizResponses) && lead.quizResponses.length > 0;

    const history: any[] = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    if (!fromQuiz && history.length === 0) {
      const insights = { painPoints: null, messagesPerDayMentioned: null, otherNotes: 'Sem histórico de conversa.', generatedAt: new Date().toISOString() };
      await this.leadsRepo.update(leadId, { conversationInsights: insights });
      return { ...lead, conversationInsights: insights };
    }

    const transcript = fromQuiz
      ? lead.quizResponses!.map((r) => `Pergunta: ${r.question}\nResposta: ${r.answer}`).join('\n\n')
      : history.map((m) => `${m.role === 'assistant' ? 'Vendedora' : 'Lead'}: ${m.content}`).join('\n');

    const model = (await this.settings.get(SDR_MODEL_KEY)) || this.defaultModel;

    const systemPrompt = fromQuiz ? `Você é um analista de vendas que lê as respostas de um quiz de qualificação respondido por uma pessoa que vende cabelo/mega hair (revendedora, não consumidora final) — ela veio de um anúncio pago, respondeu o quiz e entrou no grupo do Workshop.

O objetivo é preparar a vendedora pra uma ligação/live onde ela vai OFERECER um plano de R$410/mês de uma IA de atendimento automático via WhatsApp (que qualifica lead, responde 24h, tira a revendedora de ter que responder tudo manualmente).

Leia as respostas do quiz abaixo e responda em JSON com este formato exato:
{
  "painPoints": "resumo curto (1-2 frases) das dores/dificuldades que dá pra inferir das respostas — ex: alto volume de mensagens sugere dificuldade de dar conta sozinha, etc. null se não der pra inferir nada.",
  "messagesPerDayMentioned": <número inteiro se alguma resposta indicar quantas mensagens/dia ela recebe (ex: "30 - 50" -> use o valor médio/limite superior como estimativa), senão null>,
  "otherNotes": "outras informações relevantes pra venda extraídas das respostas: faturamento, se já faz tráfego pago, nível de urgência aparente, etc. null se não há nada relevante além do já capturado."
}

Responda SOMENTE o JSON, nada além disso. Nunca invente informação que não está nas respostas — use null quando não souber.` : `Você é um analista de vendas que lê conversas de WhatsApp entre uma vendedora de cabelo/mega hair (Alex, via assistente Sofia) e uma cliente que TAMBÉM vende mega hair (é uma revendedora, não consumidora final).

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

  /**
   * Agregação das respostas do quiz pra dashboard (overview) — usado pra
   * preparar conteúdo de aula com base em quem realmente está no grupo, não
   * achismo. Casa a pergunta por palavra-chave (não por índice/id) porque o
   * texto exato da pergunta pode mudar entre edições do quiz no builder.
   */
  async getQuizStats(): Promise<{
    totalLeads: number;
    totalWithQuiz: number;
    faturamento: { label: string; count: number }[];
    trafegoPago: { label: string; count: number }[];
    mensagensPorDia: { label: string; count: number }[];
  }> {
    const leads = await this.listLeads();
    const withQuiz = leads.filter((l) => Array.isArray(l.quizResponses) && l.quizResponses.length > 0);

    const tally = (matchQuestion: (q: string) => boolean): { label: string; count: number }[] => {
      const counts = new Map<string, number>();
      for (const lead of withQuiz) {
        const responses = lead.quizResponses as { question: string; answer: string }[];
        const match = responses.find((r) => matchQuestion((r.question ?? '').toLowerCase()));
        if (!match?.answer) continue;
        counts.set(match.answer, (counts.get(match.answer) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
    };

    return {
      totalLeads: leads.length,
      totalWithQuiz: withQuiz.length,
      faturamento: tally((q) => q.includes('faturamento')),
      trafegoPago: tally((q) => q.includes('trafego') || q.includes('tráfego')),
      mensagensPorDia: tally((q) => q.includes('mensagens') && q.includes('dia')),
    };
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
