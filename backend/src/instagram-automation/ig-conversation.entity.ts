import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type IgConversationOrigin = 'comment' | 'direct';

@Entity('ig_conversations')
export class IgConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sender_ig_id', type: 'varchar' })
  senderIgId: string;

  @Column({ name: 'ig_username', type: 'varchar', nullable: true })
  igUsername?: string;

  // null = conversa "catch-all" (DM direta sem vir de comentário/automação
  // específica) — ver getCatchallConfig() em instagram-automation.service.ts.
  @Column({ name: 'automation_id', type: 'uuid', nullable: true })
  automationId: string | null;

  @Column({ name: 'step', type: 'varchar', default: 'waiting_email' })
  step: string; // 'waiting_email' | 'waiting_confirmation' | 'ai_chat' | 'completed'

  @Column({ name: 'email', type: 'varchar', nullable: true })
  email?: string;

  // Mantido como rede de segurança — não é mais escrito depois da migração
  // pra IgMessage (fonte única de verdade agora é a tabela ig_messages, ver
  // buildAiHistory em instagram-automation.service.ts). Remoção definitiva
  // fica pra uma limpeza futura, depois de validar em produção.
  @Column({ name: 'ai_context', type: 'jsonb', nullable: true })
  aiContext?: any[];

  // --- Denormalizado para a lista de conversas (evita N+1 / join) ---

  @Index()
  @Column({ name: 'last_message_at', type: 'timestamp', nullable: true })
  lastMessageAt?: Date;

  @Column({ name: 'last_message_preview', type: 'varchar', length: 280, nullable: true })
  lastMessagePreview?: string;

  @Column({ name: 'last_message_direction', type: 'varchar', nullable: true })
  lastMessageDirection?: 'inbound' | 'outbound';

  @Column({ name: 'unread_count', type: 'int', default: 0 })
  unreadCount: number;

  /** Operador assumiu a conversa — a IA para de responder. */
  @Column({ name: 'ai_paused', type: 'boolean', default: false })
  aiPaused: boolean;

  /** Setado na 1ª vez que `email` é preenchido, nunca sobrescrito depois — métrica de tempo até virar lead. */
  @Column({ name: 'email_captured_at', type: 'timestamp', nullable: true })
  emailCapturedAt?: Date;

  /** Decidido na criação da conversa, nunca muda depois. */
  @Column({ name: 'origin_type', type: 'varchar', default: 'direct' })
  originType: IgConversationOrigin;

  /** Media id do post comentado, se `originType==='comment'`. */
  @Column({ name: 'origin_post_id', type: 'varchar', nullable: true })
  originPostId?: string;

  @Column({ name: 'origin_comment_text', type: 'text', nullable: true })
  originCommentText?: string;

  /** Corte usado por `buildAiHistory` — mensagens antes disso são ignoradas pela IA, mas continuam visíveis na tela. */
  @Column({ name: 'context_reset_at', type: 'timestamp', nullable: true })
  contextResetAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
