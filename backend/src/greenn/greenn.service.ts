import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { FacebookService } from '../facebook/facebook.service';
import { QuizService } from '../quiz/quiz.service';
import { Quiz } from '../common/entities/quiz.entity';
import { LeadsService } from '../leads/leads.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { KanbanStage } from '../common/entities/lead.entity';
import { GreennPixQueueService, PixPendingJobData } from './greenn-pix-queue.service';
import { GREENN_PIX_PENDING_DELAY_MS } from '../queue/queue.constants';

// Tags que identificam de qual dos 3 eventos da Greenn o Lead/cliente veio —
// renderizadas como badge no Kanban (ver KanbanLeads.jsx).
const TAG_COMPROU = 'greenn_comprou';
const TAG_CARRINHO_ABANDONADO = 'greenn_carrinho_abandonado';
const TAG_PIX_PENDENTE = 'greenn_pix_pendente';

interface GreennWebhookPayload {
  type?: string;
  event?: string;
  sale?: {
    id?: number;
    status?: string;
    amount?: number;
    // Código Pix copia-e-cola já gerado pra essa venda — a Greenn não manda
    // no webhook a URL da página de pagamento (token/s_id são do checkout
    // front-end), só esse código, então é o que dá pra reaproveitar sem
    // fazer o lead preencher o checkout de novo.
    qrcode?: string;
  };
  client?: {
    name?: string;
    email?: string;
    cellphone?: string;
  };
  lead?: {
    id?: number;
    name?: string;
    email?: string;
    cellphone?: string;
  };
}

// Evita reenviar a mesma mensagem/evento se a Greenn reenviar o mesmo webhook
// (retry de rede, reprocessamento manual etc) — chave = telefone normalizado,
// valor = timestamp do último envio. Em memória (não sobrevive a
// redeploy/restart), suficiente pro volume atual; se crescer, migra pra uma
// coluna/tabela.
const RECOVERY_DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h

@Injectable()
export class GreennService {
  private readonly logger = new Logger(GreennService.name);
  private readonly recentAbandonedSends = new Map<string, number>();

  constructor(
    private readonly facebookService: FacebookService,
    private readonly quizService: QuizService,
    private readonly config: ConfigService,
    private readonly leadsService: LeadsService,
    private readonly realtime: RealtimeGateway,
    private readonly pixQueue: GreennPixQueueService,
  ) {}

  async processWebhook(payload: GreennWebhookPayload): Promise<void> {
    if (payload?.type === 'sale' && payload?.event === 'saleUpdated') {
      if (payload.sale?.status === 'paid') {
        await this.processSalePaid(payload);
      } else if (payload.sale?.status === 'waiting_payment') {
        await this.processSaleWaitingPayment(payload);
      }
    } else if (payload?.type === 'lead' && payload?.event === 'checkoutAbandoned') {
      await this.processCheckoutAbandoned(payload);
    }
  }

  /** Único produto vendido via checkout até agora. Configurável via env pra
   * não precisar mexer em código se um 2º produto/quiz passar a vender. */
  private async getQuiz(): Promise<Quiz | null> {
    const quizSlug = this.config.get('GREENN_QUIZ_SLUG') || '5fornecedores';
    try {
      return await this.quizService.findBySlug(quizSlug);
    } catch {
      this.logger.warn(`Quiz "${quizSlug}" não encontrado`);
      return null;
    }
  }

  private async processSalePaid(payload: GreennWebhookPayload): Promise<void> {
    if (payload?.sale?.status !== 'paid') {
      return; // só conta Purchase quando a venda está efetivamente paga
    }

    const saleId = payload.sale?.id;
    if (!saleId) {
      this.logger.warn('Webhook da Greenn com venda paga sem sale.id — ignorado');
      return;
    }

    const quiz = await this.getQuiz();
    const pixelOverride =
      quiz?.fbPixelId && quiz?.fbAccessToken ? { pixelId: quiz.fbPixelId, accessToken: quiz.fbAccessToken } : undefined;

    await this.facebookService.sendExternalPurchaseEvent(
      {
        email: payload.client?.email,
        phone: payload.client?.cellphone,
        name: payload.client?.name,
      },
      payload.sale?.amount ?? 0,
      `greenn-sale-${saleId}`,
      undefined,
      pixelOverride,
    );

    this.logger.log(`Purchase enviado ao Facebook — venda Greenn #${saleId}`);

    if (payload.client?.cellphone) {
      await this.upsertLead({
        phone: this.normalizePhone(payload.client.cellphone),
        name: payload.client?.name,
        email: payload.client?.email,
        tag: TAG_COMPROU,
        kanbanStage: 'vendeu',
      });
    }
  }

  private async processCheckoutAbandoned(payload: GreennWebhookPayload): Promise<void> {
    const phone = payload.lead?.cellphone;
    if (!phone) {
      this.logger.warn('Webhook da Greenn de checkout abandonado sem telefone — ignorado');
      return;
    }

    const normalizedPhone = this.normalizePhone(phone);
    const lastSentAt = this.recentAbandonedSends.get(normalizedPhone);
    if (lastSentAt && Date.now() - lastSentAt < RECOVERY_DEDUPE_WINDOW_MS) {
      this.logger.log(`Checkout abandonado (${normalizedPhone}) ignorado — mensagem já enviada há pouco`);
      return;
    }

    const quiz = await this.getQuiz();
    const firstName = payload.lead?.name?.trim().split(' ')[0] || '';
    const checkoutUrl = quiz?.checkoutUrl || '';
    const greeting = firstName ? `Oi, ${firstName}! ` : 'Oi! ';
    const text = `${greeting}vi que você chegou a começar a garantir os 5 fornecedores validados, mas não finalizou 👀\n\nAinda dá tempo de concluir e já receber o acesso:\n${checkoutUrl}\n\nQualquer dúvida antes de fechar, me chama por aqui mesmo.`;

    const sent = await this.sendWhatsappText(normalizedPhone, text);
    if (sent) {
      this.recentAbandonedSends.set(normalizedPhone, Date.now());
      this.logger.log(`Mensagem de carrinho abandonado enviada para ${normalizedPhone}`);
    }

    // Sinal de intenção pro Meta otimizar a campanha e permitir remarketing de
    // quem chegou perto de comprar — independente do WhatsApp ter sido
    // entregue ou não. eventId por lead.id (se a Greenn mandar) evita duplicar
    // se o webhook for reprocessado; sem id, cai pro telefone (ainda dedupa
    // reenvios idênticos, só não distingue 2 abandonos reais do mesmo dia).
    const pixelOverride =
      quiz?.fbPixelId && quiz?.fbAccessToken ? { pixelId: quiz.fbPixelId, accessToken: quiz.fbAccessToken } : undefined;
    const eventId = payload.lead?.id ? `greenn-abandoned-${payload.lead.id}` : `greenn-abandoned-${normalizedPhone}`;
    await this.facebookService.sendExternalEvent(
      'InitiateCheckout',
      { email: payload.lead?.email, phone: normalizedPhone, name: payload.lead?.name },
      undefined,
      eventId,
      undefined,
      pixelOverride,
    );

    await this.upsertLead({
      phone: normalizedPhone,
      name: payload.lead?.name,
      email: payload.lead?.email,
      tag: TAG_CARRINHO_ABANDONADO,
      kanbanStage: 'novo',
    });
  }

  private async processSaleWaitingPayment(payload: GreennWebhookPayload): Promise<void> {
    const phone = payload.client?.cellphone;
    if (!phone) {
      this.logger.warn('Webhook da Greenn de Pix aguardando pagamento sem telefone — ignorado');
      return;
    }

    const normalizedPhone = this.normalizePhone(phone);

    // Sinal de intenção pro Meta e o registro no Kanban acontecem na hora —
    // só a MENSAGEM de recuperação espera. Ver sendPixPendingRecoveryIfStillPending.
    const quiz = await this.getQuiz();
    const pixelOverride =
      quiz?.fbPixelId && quiz?.fbAccessToken ? { pixelId: quiz.fbPixelId, accessToken: quiz.fbAccessToken } : undefined;
    const eventId = payload.sale?.id ? `greenn-waiting-${payload.sale.id}` : `greenn-waiting-${normalizedPhone}`;
    await this.facebookService.sendExternalEvent(
      'InitiateCheckout',
      { email: payload.client?.email, phone: normalizedPhone, name: payload.client?.name },
      undefined,
      eventId,
      undefined,
      pixelOverride,
    );

    await this.upsertLead({
      phone: normalizedPhone,
      name: payload.client?.name,
      email: payload.client?.email,
      tag: TAG_PIX_PENDENTE,
      kanbanStage: 'novo',
    });

    const jobData: PixPendingJobData = {
      saleId: payload.sale?.id,
      phone: normalizedPhone,
      name: payload.client?.name,
      qrcode: payload.sale?.qrcode,
    };
    const scheduled = await this.pixQueue.scheduleCheck(jobData);
    if (scheduled) {
      this.logger.log(
        `Pix aguardando pagamento (${normalizedPhone}) — recuperação agendada pra daqui ${GREENN_PIX_PENDING_DELAY_MS / 60_000}min`,
      );
    } else {
      // Fila indisponível (QUEUE_ENGINE != bullmq) — mantém o comportamento
      // antigo de mandar na hora, em vez de perder a mensagem.
      this.logger.warn('Fila greenn-pix-pending indisponível — enviando recuperação de Pix na hora (sem espera)');
      await this.sendPixPendingRecoveryIfStillPending(jobData);
    }
  }

  /**
   * Roda 8min depois do Pix ser gerado (job da fila greenn-pix-pending, ou
   * na hora se a fila estiver desabilitada). Antes de mandar, checa no banco
   * se o lead já foi marcado como "comprou" nesse meio-tempo — se sim, o
   * pagamento já caiu e a recuperação não faz sentido mais.
   */
  async sendPixPendingRecoveryIfStillPending(data: PixPendingJobData): Promise<void> {
    const existing = await this.leadsService.findByPhoneSuffix(data.phone);
    if (existing?.tags?.includes(TAG_COMPROU)) {
      this.logger.log(`Pix (${data.phone}) já foi pago antes dos 8min — recuperação cancelada`);
      return;
    }

    const quiz = await this.getQuiz();
    const firstName = data.name?.trim().split(' ')[0] || '';
    const pixCode = data.qrcode?.trim();
    const greeting = firstName ? `Oi, ${firstName}! ` : 'Oi! ';
    // Código Pix vai numa mensagem separada, sozinho — colado junto do texto
    // o WhatsApp não deixa selecionar só o código pra copiar (segura-e-copia
    // pega a bolha inteira). Sem o código no payload (não deveria acontecer,
    // mas por segurança), cai pro link de checkout como antes, numa mensagem só.
    const text = pixCode
      ? `${greeting}Os 5 fornecedores validados que vão aumentar seu faturamento (e te livrar de golpe) já estão garantidos — só falta confirmar o Pix pra liberar 👀\n\nO código vem na próxima mensagem, é só copiar e colar no seu banco.\n\nJá pagou? Me chama que eu confirmo.`
      : `${greeting}Os 5 fornecedores validados que vão aumentar seu faturamento (e te livrar de golpe) já estão garantidos — só falta confirmar o Pix pra liberar 👀\n\nSe ainda não pagou, finaliza antes que o Pix expire:\n${quiz?.checkoutUrl || ''}\n\nJá pagou? Me chama que eu confirmo.`;

    let sent = await this.sendWhatsappText(data.phone, text);
    if (sent && pixCode) {
      sent = await this.sendWhatsappText(data.phone, pixCode);
    }
    if (sent) {
      this.logger.log(`Mensagem de Pix aguardando pagamento enviada para ${data.phone}`);
    }
  }

  /**
   * Cria (ou marca, se já existir — ex: lead antigo do workshop) o cliente/lead
   * no CRM pra cada um dos 3 momentos da Greenn (comprou, abandonou carrinho,
   * Pix pendente), com tag própria pra distinguir no Kanban. Mudança de stage
   * só é forçada no caso de compra (avança pra "vendeu" mesmo que a pessoa já
   * estivesse em outra raia); nos outros 2 casos, se o lead já existe, só
   * adiciona a tag — não mexe na posição dele no Kanban.
   */
  private async upsertLead(params: {
    phone: string;
    name?: string;
    email?: string;
    tag: string;
    kanbanStage: KanbanStage;
  }): Promise<void> {
    const { phone, tag, kanbanStage } = params;
    const name = params.name?.trim() || 'Cliente Greenn';
    const email = params.email?.trim() || undefined;

    try {
      const existing = await this.leadsService.findByPhoneSuffix(phone);
      if (existing) {
        let tags = existing.tags || [];
        const patch: Record<string, any> = {};
        // Comprou torna as tags anteriores (pix pendente / carrinho abandonado)
        // obsoletas — sem isso ficavam "penduradas" mesmo depois da compra,
        // dando a impressão errada de que ela nunca finalizou (caso real:
        // Renata Pasche e Isaline Araújo em 2026-09-18).
        if (tag === TAG_COMPROU) {
          tags = tags.filter((t) => t !== TAG_PIX_PENDENTE && t !== TAG_CARRINHO_ABANDONADO);
        }
        if (!tags.includes(tag)) tags = [...tags, tag];
        if (JSON.stringify(tags) !== JSON.stringify(existing.tags || [])) patch.tags = tags;
        if (tag === TAG_COMPROU && existing.kanbanStage !== kanbanStage) patch.kanbanStage = kanbanStage;
        if (Object.keys(patch).length === 0) return;
        const updated = await this.leadsService.update(existing.id, patch);
        this.realtime.emitLeadUpdated(updated);
        this.logger.log(`Lead ${existing.id} (${phone}) marcado com tag "${tag}"`);
        return;
      }

      const created = await this.leadsService.create({
        name,
        phone,
        email,
        status: 'novo',
        // Sem isso o lead não aparece em nenhuma raia do Kanban — findKanban
        // (leads.service.ts) filtra TODAS as raias por agentMode:'sdr', sem
        // fallback pra NULL (só kanbanStage tem fallback, na raia "novo").
        // Bug real: 2 vendas da Greenn em 2026-09-18 criaram lead (visível na
        // tela de Leads) mas invisível no Kanban por faltar isso.
        agentMode: 'sdr',
        kanbanStage,
        kanbanStageManual: false,
        // Contato transacional (comprou/checkout na Greenn), não da esteira de
        // qualificação da Sofia — evita ela puxar assunto de qualificação com
        // quem só está no meio de uma compra.
        aiPaused: true,
        tags: [tag],
      });
      this.realtime.emitLeadCreated(created);
      this.logger.log(`Lead ${created.id} (${phone}) criado com tag "${tag}"`);
    } catch (err: any) {
      // Nunca deixa um conflito de email/telefone duplicado derrubar o envio
      // do evento pro Meta ou a mensagem de WhatsApp — o Lead no CRM é um
      // "extra", não o core do webhook.
      this.logger.error(`Erro ao criar/atualizar Lead da Greenn (${phone}): ${err.message}`);
    }
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    return digits.startsWith('55') ? digits : `55${digits}`;
  }

  /** Mesma instância uazapi da Sofia (SDR) — é a que está de fato configurada
   * e ativa neste projeto (ver manual-message.controller.ts) — mas dá pra usar
   * um número dedicado só pra esse disparo via GREENN_UAZAPI_BASE_URL/
   * GREENN_UAZAPI_TOKEN (instância própria conectada na uazapi), sem tocar
   * em código. Sem esse par específico, cai pro par da Sofia (SDR). */
  private async sendWhatsappText(phone: string, text: string): Promise<boolean> {
    const baseUrl =
      this.config.get('GREENN_UAZAPI_BASE_URL') || this.config.get('SDR_UAZAPI_BASE_URL') || this.config.get('UAZAPI_BASE_URL');
    const token = this.config.get('GREENN_UAZAPI_TOKEN') || this.config.get('SDR_UAZAPI_TOKEN');
    if (!baseUrl || !token) {
      this.logger.warn('GREENN_UAZAPI_TOKEN/SDR_UAZAPI_TOKEN não configurados — mensagem de recuperação não enviada');
      return false;
    }

    try {
      await axios.post(`${baseUrl}/send/text`, { number: phone, text }, { headers: { token } });
      return true;
    } catch (err: any) {
      this.logger.error(`Erro ao enviar WhatsApp de recuperação para ${phone}: ${err.message}`);
      return false;
    }
  }
}
