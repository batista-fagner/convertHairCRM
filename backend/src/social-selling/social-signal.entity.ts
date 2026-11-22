import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type SocialSignalType = 'follow' | 'comment';

/** Histórico de sinais (um por evento). O resumo por pessoa fica em social_leads. */
@Entity('social_signals')
export class SocialSignal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'social_lead_id', type: 'uuid' })
  socialLeadId: string;

  @Column({ name: 'type', type: 'varchar' })
  type: SocialSignalType;

  /** Só comentário: dedupe de retry do webhook. */
  @Column({ name: 'comment_id', type: 'varchar', nullable: true, unique: true })
  commentId?: string | null;

  @Column({ name: 'comment_text', type: 'text', nullable: true })
  commentText?: string | null;

  @Column({ name: 'intent', type: 'varchar', nullable: true })
  intent?: string | null;

  @Column({ name: 'media_id', type: 'varchar', nullable: true })
  mediaId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
