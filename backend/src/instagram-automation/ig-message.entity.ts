import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type IgMessageDirection = 'inbound' | 'outbound';

/** Quem produziu a mensagem — define a cor da bolha na inbox (mesmo padrão de SmsMessageSource). */
export type IgMessageSource = 'contact' | 'ai' | 'operator' | 'system';

/**
 * Fonte única de verdade do histórico de uma conversa de DM — substitui o
 * antigo `IgConversation.aiContext` (jsonb solto). A IA monta seu contexto
 * lendo esta tabela (ver `buildAiHistory` em instagram-automation.service.ts),
 * e a tela de inbox pagina por aqui em vez de parsear um blob.
 */
@Entity('ig_messages')
@Index(['conversationId', 'createdAt'])
export class IgMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK lógica — projeto não usa relations do TypeORM. */
  @Index()
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'direction', type: 'varchar' })
  direction: IgMessageDirection;

  @Column({ name: 'body', type: 'text' })
  body: string;

  @Column({ name: 'source', type: 'varchar' })
  source: IgMessageSource;

  // Instagram Graph API não dá webhook de entrega como o Twilio — só sabemos
  // se a chamada de envio falhou ou não.
  @Column({ name: 'status', type: 'varchar', default: 'sent' })
  status: 'sent' | 'failed';

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  /** Só inbound — quando o operador visualizou na tela. */
  @Column({ name: 'read_at', type: 'timestamp', nullable: true })
  readAt?: Date;

  /** { systemEvent: true } pro chip de "contexto reiniciado"; { buttonLabel, link } quando enviado com botão. */
  @Column({ name: 'meta', type: 'jsonb', nullable: true })
  meta?: Record<string, unknown>;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
