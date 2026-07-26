import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

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

  @Column({ name: 'ai_context', type: 'jsonb', nullable: true })
  aiContext?: any[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
