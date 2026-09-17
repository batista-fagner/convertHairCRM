import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FacebookService } from '../facebook/facebook.service';
import { QuizService } from '../quiz/quiz.service';

interface GreennSalePayload {
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
}

@Injectable()
export class GreennService {
  private readonly logger = new Logger(GreennService.name);

  constructor(
    private readonly facebookService: FacebookService,
    private readonly quizService: QuizService,
    private readonly config: ConfigService,
  ) {}

  async processSaleWebhook(payload: GreennSalePayload): Promise<void> {
    if (payload?.type !== 'sale' || payload?.event !== 'saleUpdated') {
      return; // só nos interessa mudança de status de venda
    }
    if (payload?.sale?.status !== 'paid') {
      return; // só conta Purchase quando a venda está efetivamente paga
    }

    const saleId = payload.sale?.id;
    if (!saleId) {
      this.logger.warn('Webhook da Greenn com venda paga sem sale.id — ignorado');
      return;
    }

    // Único produto vendido via checkout até agora. Configurável via env pra
    // não precisar mexer em código se um 2º produto/quiz passar a vender.
    const quizSlug = this.config.get('GREENN_QUIZ_SLUG') || '5fornecedores';
    let pixelOverride: { pixelId?: string; accessToken?: string } | undefined;
    try {
      const quiz = await this.quizService.findBySlug(quizSlug);
      if (quiz?.fbPixelId && quiz?.fbAccessToken) {
        pixelOverride = { pixelId: quiz.fbPixelId, accessToken: quiz.fbAccessToken };
      }
    } catch {
      this.logger.warn(`Quiz "${quizSlug}" não encontrado — Purchase da Greenn cairá no pixel global`);
    }

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
}
