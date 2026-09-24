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
    // Campos automáticos da Greenn (ch_id, fbclid, fbc, fbp, reuse_credit_card
    // etc) — sempre nesse formato array. NÃO é onde utm_source/medium/campaign
    // aparecem (ver productMetas abaixo) — bug real encontrado em 2026-09-22:
    // a extração antiga procurava utm aqui e nunca achava nada.
    saleMetas?: { meta_key?: string; meta_value?: string }[];
  };
  // As "Metas" cadastradas manualmente no dashboard da Greenn (Trackeamento →
  // Metas) voltam AQUI, no nível raiz do payload — objeto simples chave/valor,
  // não array, e não dentro de `sale`. Confirmado com payload real (venda
  // Andressa oliveira, 2026-09-22): {"utm_source":"whatsapp_grupo",
  // "utm_medium":"organic","utm_campaign":"disparo-base-22-09"}.
  productMetas?: Record<string, string>;
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

/** Lê utm_source/utm_medium/utm_campaign de productMetas (nível raiz do
 * payload, não dentro de `sale`) — devolve undefined pra cada chave ausente
 * (upsertLead só grava o que vier preenchido). */
function extractUtmFromProductMetas(productMetas?: Record<string, string>) {
  return {
    utmSource: productMetas?.utm_source || undefined,
    utmMedium: productMetas?.utm_medium || undefined,
    utmCampaign: productMetas?.utm_campaign || undefined,
  };
}

/**
 * Lê fbclid/fbc/fbp de sale.saleMetas (campos automáticos da Greenn, capturados
 * do navegador de quem pagou — ver comentário no tipo GreennWebhookPayload).
 * Existe pra cobrir quem compra direto no checkout sem nunca ter virado lead
 * antes (quiz/grupo) — pra esses, é a ÚNICA fonte real de clique que temos;
 * achado em 2026-09-24 depurando uma venda "orgânica" que na verdade tinha
 * fbc/fbp de clique de anúncio, e a gente nunca guardava esse dado aqui.
 */
function extractTrackingFromSaleMetas(saleMetas?: { meta_key?: string; meta_value?: string }[]) {
  const get = (key: string) => saleMetas?.find((m) => m.meta_key === key)?.meta_value || undefined;
  return {
    fbclid: get('fbclid'),
    fbc: get('fbc'),
    fbp: get('fbp'),
  };
}

@Injectable()
export class GreennService {
  private readonly logger = new Logger(GreennService.name);
  private readonly recentAbandonedSends = new Map<string, number>();
  private readonly recentWelcomeSends = new Map<string, number>();

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

    // DESATIVADO em 2026-09-20: a Greenn passou a mandar o Purchase ela mesma
    // (pixel nativo dela no checkout, configurado no dashboard dela pro
    // mesmo pixel 4085030201797853) — mandar os dois duplicava a venda pro
    // Meta (Ads Manager contando 2x). O pixel nativo da Greenn tem vantagem
    // real sobre esse envio daqui: dispara no navegador de quem paga, então
    // carrega fbc/fbp de verdade, o que a gente nunca tinha aqui (só
    // email/telefone/nome, sem clique). Se precisar reativar (ex: a Greenn
    // tirar o pixel dela do ar), é só descomentar o bloco abaixo.
    //
    // const pixelOverride =
    //   quiz?.fbPixelId && quiz?.fbAccessToken ? { pixelId: quiz.fbPixelId, accessToken: quiz.fbAccessToken } : undefined;
    // await this.facebookService.sendExternalPurchaseEvent(
    //   {
    //     email: payload.client?.email,
    //     phone: payload.client?.cellphone,
    //     name: payload.client?.name,
    //   },
    //   payload.sale?.amount ?? 0,
    //   `greenn-sale-${saleId}`,
    //   undefined,
    //   pixelOverride,
    // );
    // this.logger.log(`Purchase enviado ao Facebook — venda Greenn #${saleId}`);

    if (payload.client?.cellphone) {
      const normalizedPhone = this.normalizePhone(payload.client.cellphone);
      await this.upsertLead({
        phone: normalizedPhone,
        name: payload.client?.name,
        email: payload.client?.email,
        tag: TAG_COMPROU,
        kanbanStage: 'vendeu',
        ...extractUtmFromProductMetas(payload.productMetas),
        ...extractTrackingFromSaleMetas(payload.sale?.saleMetas),
      });
      await this.sendWelcomeMessage(normalizedPhone, payload.client?.name);
    }
  }

  /**
   * Boas-vindas de quem comprou — gancho é o bônus de +2 fornecedores, que só
   * é liberado numa ligação. O objetivo real não é o bônus em si: é abrir uma
   * conversa por telefone que serve pra oferecer o upgrade da IA depois (já
   * validado manualmente — a 1ª ligação feita assim converteu uma venda).
   * Pergunta o horário porque quem responde com uma hora concreta é o lead
   * que vale a pena o sócio ligar primeiro.
   */
  private async sendWelcomeMessage(phone: string, name?: string): Promise<void> {
    const lastSentAt = this.recentWelcomeSends.get(phone);
    if (lastSentAt && Date.now() - lastSentAt < RECOVERY_DEDUPE_WINDOW_MS) {
      this.logger.log(`Boas-vindas (${phone}) ignorada — mensagem já enviada há pouco`);
      return;
    }

    const firstName = name?.trim().split(' ')[0] || '';
    const greeting = firstName ? `Oi, ${firstName}! ` : 'Oi! ';
    const text = `${greeting}Parabéns pela decisão 🙌 Seus 5 fornecedores validados já estão liberados.\n\nTenho uma novidade: como você comprou, você ganhou acesso a um bônus exclusivo — mais 2 fornecedores validados, além dos 5. Pra te passar os detalhes, vamos te ligar rapidinho.\n\nQual o melhor horário pra você hoje ou amanhã?`;

    const sent = await this.sendWhatsappText(phone, text);
    if (sent) {
      this.recentWelcomeSends.set(phone, Date.now());
      this.logger.log(`Mensagem de boas-vindas enviada para ${phone}`);
      await this.recordAssistantMessage(phone, text);
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
    const text = `${greeting}Os 5 fornecedores validados que vão aumentar seu faturamento (e te livrar de golpe) estão te esperando — você chegou a começar, mas não finalizou 👀\n\nAinda dá tempo de concluir e já receber o acesso:\n${checkoutUrl}\n\nQualquer dúvida antes de fechar, me chama por aqui mesmo.`;

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
      ...extractUtmFromProductMetas(payload.productMetas),
      ...extractTrackingFromSaleMetas(payload.sale?.saleMetas),
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
      // Registra no histórico do CRM (a mensagem em si já saiu por fora do
      // módulo SDR) — sem isso o cron de follow-up/cadência nunca considera
      // este lead elegível: ele exige wa_last_message_at preenchido e a
      // última entrada do aiContext com role 'assistant' pra contar o prazo
      // até o próximo toque. Ver memória "greenn recovery msg not in CRM".
      await this.recordAssistantMessage(data.phone, text);
    }
  }

  private async recordAssistantMessage(phone: string, text: string): Promise<void> {
    const lead = await this.leadsService.findByPhoneSuffix(phone);
    if (!lead) return;
    const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    await this.leadsService.update(lead.id, {
      aiContext: [...ctx, { role: 'assistant', content: text, timestamp: new Date().toISOString() }],
      waLastMessageAt: new Date(),
    });
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
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    fbclid?: string;
    fbc?: string;
    fbp?: string;
  }): Promise<void> {
    const { phone, tag, kanbanStage } = params;
    const name = params.name?.trim() || 'Cliente Greenn';
    const email = params.email?.trim() || undefined;
    // Tag da campanha (ex: utm_campaign="disparo-grupo-22-09") — aplicada
    // mesmo em lead JÁ existente, sem mexer na origem original dele (utmSource/
    // utmMedium/utmCampaign do lead só são gravados na criação). É como um
    // lead antigo do workshop que comprou por um disparo no grupo fica
    // marcado como "veio desse disparo" sem perder o histórico de onde ele
    // entrou de fato no CRM.
    const campaignTag = params.utmCampaign?.trim() || undefined;

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
        if (campaignTag && !tags.includes(campaignTag)) tags = [...tags, campaignTag];
        if (JSON.stringify(tags) !== JSON.stringify(existing.tags || [])) patch.tags = tags;
        if (tag === TAG_COMPROU && existing.kanbanStage !== kanbanStage) patch.kanbanStage = kanbanStage;
        // Só preenche o que tava faltando — nunca sobrescreve fbclid/fbc/fbp
        // que o lead já tinha (do clique real capturado quando ele entrou no
        // funil pelo quiz/grupo, que é uma atribuição melhor que a do checkout).
        if (params.fbclid && !existing.fbclid) patch.fbclid = params.fbclid;
        if (params.fbc && !existing.fbc) patch.fbc = params.fbc;
        if (params.fbp && !existing.fbp) patch.fbp = params.fbp;
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
        // Só na criação — um lead que já existia (ex: veio antes do workshop)
        // mantém a origem original, a Greenn não "rouba" a atribuição dele.
        utmSource: params.utmSource,
        utmMedium: params.utmMedium,
        utmCampaign: params.utmCampaign,
        // Única fonte de clique real que existe pra quem nunca passou pelo
        // quiz/grupo antes de comprar — ver extractTrackingFromSaleMetas.
        fbclid: params.fbclid,
        fbc: params.fbc,
        fbp: params.fbp,
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
        tags: campaignTag ? [tag, campaignTag] : [tag],
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
