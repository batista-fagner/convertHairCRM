import { SmsDeliveryStatus } from '../entities/sms-message.entity';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsSendRequest {
  /** E.164 */
  to: string;
  from?: string;
  body: string;
  /** `SmsMessage.id` — volta no status callback e serve de chave de idempotência. */
  clientRef: string;
}

export interface SmsSendResult {
  providerMessageId?: string;
  status: SmsDeliveryStatus;
  errorCode?: string;
  errorMessage?: string;
  segments?: number;
  raw?: unknown;
}

export interface NormalizedInboundSms {
  providerMessageId: string;
  from: string;
  to: string;
  body: string;
  receivedAt: Date;
  raw?: unknown;
}

export interface NormalizedStatusUpdate {
  providerMessageId?: string;
  /** `SmsMessage.id`, quando o provedor devolve o parâmetro que mandamos. */
  clientRef?: string;
  status: SmsDeliveryStatus;
  rawStatus?: string;
  errorCode?: string;
  errorMessage?: string;
  occurredAt: Date;
}

export interface WebhookVerifyContext {
  body: any;
  headers: Record<string, any>;
  query: Record<string, any>;
  url: string;
}

/**
 * Contrato que qualquer provedor de SMS precisa cumprir. Todo o resto do módulo
 * (service, webhook, tela) fala só com esta interface — trocar de provedor não
 * deve tocar em nenhuma linha de regra de negócio.
 */
export interface ISmsProvider {
  readonly name: string;
  getSenderNumber(): string;
  send(req: SmsSendRequest): Promise<SmsSendResult>;
  verifySignature(ctx: WebhookVerifyContext): boolean;
  parseInbound(ctx: WebhookVerifyContext): NormalizedInboundSms | null;
  parseStatusCallback(ctx: WebhookVerifyContext): NormalizedStatusUpdate | null;
}

/** Callback que o provider usa para empurrar mudanças de status assíncronas. */
export type StatusSink = (update: NormalizedStatusUpdate) => void;
