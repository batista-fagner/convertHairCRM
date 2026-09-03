import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Lead } from '../common/entities/lead.entity';
import { SmsContact } from '../sms/entities/sms-contact.entity';
import { SmsMessage } from '../sms/entities/sms-message.entity';
import { IgConversation } from '../instagram-automation/ig-conversation.entity';
import { IgMessage } from '../instagram-automation/ig-message.entity';
import { IgPost } from '../ig-posts/ig-post.entity';

/**
 * Gateway Socket.IO usado pelo Kanban para refletir em tempo real as
 * movimentações de leads feitas pela IA (SDR) ou pelo operador, pela inbox
 * de SMS para refletir mensagens e status de entrega, e pela inbox de DM do
 * Instagram para refletir mensagens e conversas.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    this.logger.log(`Cliente conectado ao realtime: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado do realtime: ${client.id}`);
  }

  emitLeadCreated(lead: Lead) {
    this.server?.emit('lead:created', lead);
  }

  emitLeadUpdated(lead: Lead) {
    this.server?.emit('lead:updated', lead);
  }

  emitLeadHandoff(lead: Lead) {
    this.server?.emit('lead:handoff', lead);
  }

  emitLeadDeleted(id: string) {
    this.server?.emit('lead:deleted', { id });
  }

  // --- Canal de SMS (inbox das alunas mentoradas) ---
  // Eventos próprios de propósito: reusar `lead:*` faria o Kanban do sócio
  // tentar renderizar contatos de SMS como cards.

  emitSmsContactCreated(contact: SmsContact) {
    this.server?.emit('sms:contact:created', contact);
  }

  emitSmsContactUpdated(contact: SmsContact) {
    this.server?.emit('sms:contact:updated', contact);
  }

  emitSmsMessageCreated(message: SmsMessage) {
    this.server?.emit('sms:message:created', message);
  }

  /** É o que faz o tick ✓✓ aparecer sozinho na tela quando a entrega confirma. */
  emitSmsMessageStatus(payload: {
    id: string;
    contactId: string;
    status: string;
    errorCode?: string;
    errorMessage?: string;
    deliveredAt?: Date | null;
  }) {
    this.server?.emit('sms:message:status', payload);
  }

  // --- Canal de Instagram DM Inbox ---
  // Eventos próprios de propósito, mesmo motivo do bloco sms:* acima.

  emitIgConversationCreated(conv: IgConversation) {
    this.server?.emit('ig:conversation:created', conv);
  }

  emitIgConversationUpdated(conv: IgConversation) {
    this.server?.emit('ig:conversation:updated', conv);
  }

  emitIgMessageCreated(message: IgMessage) {
    this.server?.emit('ig:message:created', message);
  }

  // --- Posts do Instagram (ig-posts) ---
  // Substitui o polling de 15s da tela de Posts — o status muda por ação de
  // cron/job (scheduled→processing→published|failed), não do próprio usuário.

  emitIgPostCreated(post: IgPost) {
    this.server?.emit('igpost:created', post);
  }

  emitIgPostUpdated(post: IgPost) {
    this.server?.emit('igpost:updated', post);
  }

  // --- Disparo em massa pro Grupo WhatsApp (tela /group-workshop) ---
  // Progresso ao vivo enquanto o disparo roda em background (pode levar
  // dezenas de minutos, ver GroupWorkshopService.runBroadcast).

  emitGroupBroadcastProgress(payload: { sent: number; total: number; failed: number; done: boolean }) {
    this.server?.emit('groupbroadcast:progress', payload);
  }
}
