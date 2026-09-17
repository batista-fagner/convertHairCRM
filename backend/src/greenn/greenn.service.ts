import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { FacebookService } from '../facebook/facebook.service';
import { QuizService } from '../quiz/quiz.service';
import { Quiz } from '../common/entities/quiz.entity';

interface GreennWebhookPayload {
  type?: string;
  event?: string;
  sale?: {
    id?: number;
    status?: string;
    amount?: number;
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

// Evita reenviar a mesma mensagem de abandono se a Greenn reenviar o mesmo
// webhook (retry de rede, reprocessamento manual etc) — chave = telefone
// normalizado, valor = timestamp do último envio. Em memória (não sobrevive a
// redeploy/restart), suficiente pro volume atual; se crescer, migra pra uma
// coluna/tabela.
const ABANDONED_CART_DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h

@Injectable()
export class GreennService {
  private readonly logger = new Logger(GreennService.name);
  private readonly recentAbandonedSends = new Map<string, number>();

  constructor(
    private readonly facebookService: FacebookService,
    private readonly quizService: QuizService,
    private readonly config: ConfigService,
  ) {}

  async processWebhook(payload: GreennWebhookPayload): Promise<void> {
    if (payload?.type === 'sale' && payload?.event === 'saleUpdated') {
      await this.processSalePaid(payload);
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
  }

  private async processCheckoutAbandoned(payload: GreennWebhookPayload): Promise<void> {
    const phone = payload.lead?.cellphone;
    if (!phone) {
      this.logger.warn('Webhook da Greenn de checkout abandonado sem telefone — ignorado');
      return;
    }

    const normalizedPhone = this.normalizePhone(phone);
    const lastSentAt = this.recentAbandonedSends.get(normalizedPhone);
    if (lastSentAt && Date.now() - lastSentAt < ABANDONED_CART_DEDUPE_WINDOW_MS) {
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
      this.logger.warn('GREENN_UAZAPI_TOKEN/SDR_UAZAPI_TOKEN não configurados — mensagem de abandono não enviada');
      return false;
    }

    try {
      await axios.post(`${baseUrl}/send/text`, { number: phone, text }, { headers: { token } });
      return true;
    } catch (err: any) {
      this.logger.error(`Erro ao enviar WhatsApp de carrinho abandonado para ${phone}: ${err.message}`);
      return false;
    }
  }
}
