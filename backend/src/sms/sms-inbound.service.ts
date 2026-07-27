import { Injectable, Logger } from '@nestjs/common';
import { SmsService } from './sms.service';
import { NormalizedInboundSms } from './providers/sms-provider.interface';
import { toE164Us } from './utils/phone.util';
import {
  DEFAULT_HELP_REPLY,
  DEFAULT_OPT_IN_REPLY,
  DEFAULT_OPT_OUT_REPLY,
  detectKeyword,
} from './sms-keywords';

/**
 * Pipeline de mensagem recebida.
 *
 * Ordem importa: a mensagem é persistida ANTES de qualquer tratamento, para que
 * nada se perca se o passo seguinte falhar, e o compliance (STOP/HELP/START)
 * roda ANTES da IA — resposta a essas palavras é obrigatória e determinística
 * por lei (TCPA/CTIA), não pode depender de um modelo.
 */
@Injectable()
export class SmsInboundService {
  private readonly logger = new Logger(SmsInboundService.name);

  /**
   * Dedup em memória: pega o caso comum (retry do provedor em segundos).
   * A garantia real é o índice unique de `provider_message_id` — este Set morre
   * a cada restart do Railway e não cobre múltiplas réplicas.
   */
  private readonly processedIds = new Set<string>();

  constructor(private readonly sms: SmsService) {}

  async handleInbound(inbound: NormalizedInboundSms): Promise<{ ok: true; skipped?: string }> {
    const { providerMessageId, body } = inbound;

    if (providerMessageId && this.processedIds.has(providerMessageId)) {
      return { ok: true, skipped: 'duplicate' };
    }
    if (providerMessageId) {
      this.processedIds.add(providerMessageId);
      setTimeout(() => this.processedIds.delete(providerMessageId), 5 * 60 * 1000).unref?.();
    }

    const phone = toE164Us(inbound.from);
    if (!phone) {
      this.logger.warn(`Inbound com número inválido ignorado: ${inbound.from}`);
      return { ok: true, skipped: 'invalid_phone' };
    }

    // Número desconhecido entra com a IA pausada: o agente não conversa com
    // quem não é aluna do programa.
    const contact = await this.sms.findOrCreateByPhone(phone, { aiPaused: true });

    const message = await this.sms.recordInbound(contact, body, providerMessageId);
    if (!message) return { ok: true, skipped: 'duplicate' };

    const keyword = detectKeyword(body);

    if (keyword === 'stop') {
      // Envia a confirmação ANTES de marcar o opt-out — depois de marcado, o
      // guard do sendMessage() bloqueia qualquer envio (inclusive este).
      await this.safeSend(contact.id, DEFAULT_OPT_OUT_REPLY);
      await this.sms.optOut(contact.id, body.trim().toUpperCase());
      await this.sms.logSystemEvent(contact.id, 'Contact opted out (STOP)');
      return { ok: true, skipped: 'opted_out' };
    }

    if (keyword === 'start') {
      await this.sms.optIn(contact.id, 'sms_keyword_start');
      await this.safeSend(contact.id, DEFAULT_OPT_IN_REPLY);
      await this.sms.logSystemEvent(contact.id, 'Contact opted back in (START)');
      return { ok: true };
    }

    if (keyword === 'help') {
      // Resposta obrigatória e determinística — não passa pela IA.
      await this.safeSend(contact.id, DEFAULT_HELP_REPLY);
      return { ok: true };
    }

    if (contact.optedOut) {
      return { ok: true, skipped: 'opted_out' };
    }

    // Fase 2: se `aiPaused === false`, aqui entra o debounce de 8s e o
    // SmsAgentService. Por ora a mensagem fica para o operador responder.
    return { ok: true };
  }

  /** Falha de envio de mensagem de compliance não pode derrubar o webhook. */
  private async safeSend(contactId: string, text: string) {
    try {
      await this.sms.sendMessage(contactId, text, { source: 'system', force: true });
    } catch (err: any) {
      this.logger.error(`Falha ao enviar resposta automática: ${err?.message ?? err}`);
    }
  }
}
