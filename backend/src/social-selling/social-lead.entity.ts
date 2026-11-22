import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type SocialTemperature = 'muito_quente' | 'quente' | 'morno' | 'frio';
export type CommentIntent = 'quente' | 'morno' | 'frio';
/**
 * novo: só registrado (aguarda aprovação, ou o modo está desligado)
 * na_fila: aprovado, esperando envio (comentário: job; seguidor: extensão)
 * enviando: a extensão reservou e está mandando
 * dm_enviada / respondeu / falhou
 * ignorado: já é lead, já conversa na inbox ou a automação do post respondeu
 * descartado: alguém descartou à mão
 */
export type SocialLeadStatus = 'novo' | 'na_fila' | 'enviando' | 'dm_enviada' | 'respondeu' | 'falhou' | 'ignorado' | 'descartado';
export type SocialDmChannel = 'comentario' | 'extensao';

/**
 * Uma pessoa por @ — soma os sinais (seguiu, comentou) da conta converthair e
 * guarda o andamento da abordagem. Os sinais um a um ficam em social_signals.
 */
@Entity('social_leads')
@Index(['score', 'lastSignalAt'])
export class SocialLead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Sempre minúsculo, sem @. */
  @Column({ name: 'username', type: 'varchar', unique: true })
  username: string;

  /** IGSID (vem no comentário; seguidor da extensão não traz). */
  @Index()
  @Column({ name: 'ig_user_id', type: 'varchar', nullable: true })
  igUserId?: string | null;

  @Column({ name: 'full_name', type: 'varchar', nullable: true })
  fullName?: string | null;

  @Column({ name: 'followed_at', type: 'timestamptz', nullable: true })
  followedAt?: Date | null;

  @Column({ name: 'comment_count', type: 'int', default: 0 })
  commentCount: number;

  /** Melhor intenção entre todos os comentários. */
  @Column({ name: 'best_comment_intent', type: 'varchar', nullable: true })
  bestCommentIntent?: CommentIntent | null;

  @Column({ name: 'last_comment_at', type: 'timestamptz', nullable: true })
  lastCommentAt?: Date | null;

  @Column({ name: 'last_comment_text', type: 'text', nullable: true })
  lastCommentText?: string | null;

  /** Necessário pra resposta privada (só vale até 7 dias depois do comentário). */
  @Column({ name: 'last_comment_id', type: 'varchar', nullable: true })
  lastCommentId?: string | null;

  @Column({ name: 'last_comment_media_id', type: 'varchar', nullable: true })
  lastCommentMediaId?: string | null;

  @Column({ name: 'temperature', type: 'varchar', default: 'frio' })
  temperature: SocialTemperature;

  /** 4 muito quente … 1 frio — só pra ordenar. */
  @Column({ name: 'score', type: 'int', default: 1 })
  score: number;

  @Column({ name: 'status', type: 'varchar', default: 'novo' })
  status: SocialLeadStatus;

  @Column({ name: 'skip_reason', type: 'varchar', nullable: true })
  skipReason?: string | null;

  /** Por onde a DM vai/foi (definido na aprovação ou no envio automático). */
  @Column({ name: 'dm_channel', type: 'varchar', nullable: true })
  dmChannel?: SocialDmChannel | null;

  @Column({ name: 'dm_message', type: 'text', nullable: true })
  dmMessage?: string | null;

  @Column({ name: 'dm_sent_at', type: 'timestamptz', nullable: true })
  dmSentAt?: Date | null;

  @Column({ name: 'dm_error', type: 'varchar', nullable: true })
  dmError?: string | null;

  /** Quando a extensão reservou o envio (pra devolver à fila se travar). */
  @Column({ name: 'reserved_at', type: 'timestamptz', nullable: true })
  reservedAt?: Date | null;

  @Column({ name: 'replied_at', type: 'timestamptz', nullable: true })
  repliedAt?: Date | null;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId?: string | null;

  @Column({ name: 'last_signal_at', type: 'timestamptz', nullable: true })
  lastSignalAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
