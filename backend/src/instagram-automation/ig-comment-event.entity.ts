import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Loga TODO comentário recebido nos posts da conta, bata ou não com alguma
 * automação — só assim dá pra montar a jornada completa do lead ("comentou
 * no post X, depois no Y, depois mandou DM"). Não vira linha própria na
 * inbox principal — é consultado só dentro da timeline de uma conversa
 * específica (ver `listCommentEvents` em instagram-automation.service.ts).
 */
@Entity('ig_comment_events')
@Index(['senderIgId', 'createdAt'])
export class IgCommentEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Dedupe de retry do webhook. */
  @Column({ name: 'comment_id', type: 'varchar', unique: true })
  commentId: string;

  @Index()
  @Column({ name: 'sender_ig_id', type: 'varchar' })
  senderIgId: string;

  @Column({ name: 'ig_username', type: 'varchar', nullable: true })
  igUsername?: string;

  @Column({ name: 'post_id', type: 'varchar' })
  postId: string;

  // Snapshot no momento do evento — o post pode ser apagado depois.
  // Só preenchido quando existe uma InstagramAutomation cadastrada pro post
  // (evita 1 chamada extra à Graph API por comentário aleatório).
  @Column({ name: 'post_caption', type: 'text', nullable: true })
  postCaption?: string;

  @Column({ name: 'post_thumbnail', type: 'varchar', nullable: true })
  postThumbnail?: string;

  @Column({ name: 'post_permalink', type: 'varchar', nullable: true })
  postPermalink?: string;

  @Column({ name: 'comment_text', type: 'text' })
  commentText: string;

  /** null = comentário não bateu com nenhuma automação ativa. */
  @Column({ name: 'matched_automation_id', type: 'uuid', nullable: true })
  matchedAutomationId?: string | null;

  /** Preenchido quando este comentário abriu/atualizou uma IgConversation. */
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId?: string | null;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
