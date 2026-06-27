import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Lead } from '../common/entities/lead.entity';

/**
 * Gateway Socket.IO usado pelo Kanban para refletir em tempo real as
 * movimentações de leads feitas pela IA (SDR) ou pelo operador.
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
}
