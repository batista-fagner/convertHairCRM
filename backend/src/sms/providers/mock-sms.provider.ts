import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  ISmsProvider,
  NormalizedInboundSms,
  NormalizedStatusUpdate,
  SmsSendRequest,
  SmsSendResult,
  StatusSink,
  WebhookVerifyContext,
} from './sms-provider.interface';
import { countSegments } from '../utils/segments.util';

/**
 * Provedor falso — é o que permite rodar e demonstrar a inbox inteira sem
 * contratar ninguém e sem registro A2P 10DLC.
 *
 * Simula o ciclo real de entrega: `queued` → `sent` → `delivered`, empurrando
 * cada transição pelo status sink (que o SmsService registra no boot). É isso
 * que faz os ticks ✓ → ✓✓ animarem na tela.
 *
 * Para demonstrar falha de entrega: mande um texto contendo `[fail]` ou use um
 * número terminado em `0000`.
 */
export class MockSmsProvider implements ISmsProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockSmsProvider.name);
  private statusSink?: StatusSink;
  private readonly deliveryMs: number;

  constructor(private readonly config: ConfigService) {
    this.deliveryMs = Number(this.config.get('SMS_MOCK_DELIVERY_MS') ?? 1200);
  }

  setStatusSink(sink: StatusSink) {
    this.statusSink = sink;
  }

  getSenderNumber(): string {
    return this.config.get<string>('SMS_FROM_NUMBER') || '+15555550100';
  }

  async send(req: SmsSendRequest): Promise<SmsSendResult> {
    const providerMessageId = `mock_${randomUUID()}`;
    const { segments } = countSegments(req.body);

    const shouldFail = req.body.includes('[fail]') || req.to.endsWith('0000');

    if (shouldFail) {
      // Falha imediata, como um número inválido responderia.
      this.schedule(200, {
        providerMessageId,
        clientRef: req.clientRef,
        status: 'failed',
        rawStatus: 'failed',
        errorCode: '30006',
        errorMessage: 'Landline or unreachable carrier (simulated)',
        occurredAt: new Date(),
      });
      return { providerMessageId, status: 'queued', segments };
    }

    this.schedule(Math.round(this.deliveryMs * 0.4), {
      providerMessageId,
      clientRef: req.clientRef,
      status: 'sent',
      rawStatus: 'sent',
      occurredAt: new Date(),
    });

    this.schedule(this.deliveryMs, {
      providerMessageId,
      clientRef: req.clientRef,
      status: 'delivered',
      rawStatus: 'delivered',
      occurredAt: new Date(),
    });

    this.logger.log(`[mock] SMS para ${req.to} (${segments} segmento(s)): ${req.body.slice(0, 60)}`);
    return { providerMessageId, status: 'queued', segments };
  }

  private schedule(delayMs: number, update: NormalizedStatusUpdate) {
    setTimeout(() => {
      if (!this.statusSink) {
        this.logger.warn('Status sink não registrado — atualização de entrega descartada');
        return;
      }
      try {
        this.statusSink({ ...update, occurredAt: new Date() });
      } catch (err) {
        this.logger.error(`Falha ao aplicar status simulado: ${err}`);
      }
    }, delayMs).unref?.();
  }

  verifySignature(): boolean {
    return true;
  }

  /** Aceita o formato canônico — os endpoints `/dev/simulate-*` mandam JSON limpo. */
  parseInbound(ctx: WebhookVerifyContext): NormalizedInboundSms | null {
    const b = ctx.body ?? {};
    const from = b.from ?? b.From;
    const body = b.body ?? b.Body ?? b.text;
    if (!from || typeof body !== 'string') return null;

    return {
      providerMessageId: b.providerMessageId ?? b.MessageSid ?? `mock_in_${randomUUID()}`,
      from: String(from),
      to: String(b.to ?? b.To ?? this.getSenderNumber()),
      body,
      receivedAt: new Date(),
      raw: b,
    };
  }

  parseStatusCallback(ctx: WebhookVerifyContext): NormalizedStatusUpdate | null {
    const b = ctx.body ?? {};
    const status = b.status ?? b.MessageStatus;
    if (!status) return null;

    return {
      providerMessageId: b.providerMessageId ?? b.MessageSid,
      clientRef: b.clientRef ?? b.messageId,
      status,
      rawStatus: String(status),
      errorCode: b.errorCode,
      errorMessage: b.errorMessage,
      occurredAt: new Date(),
    };
  }
}
