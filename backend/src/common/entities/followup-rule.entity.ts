import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { KanbanStage } from './lead.entity';

export type FollowupMode = 'manual' | 'ai';

// kanbanStage/utmCampaign nulos = curinga (casa com qualquer raia/campanha).
// O matching escolhe a regra mais específica pra cada lead (ver sdr-followup.service.ts).
@Entity('followup_rules')
export class FollowupRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'kanban_stage', type: 'varchar', nullable: true })
  kanbanStage?: KanbanStage | null;

  @Column({ name: 'utm_campaign', type: 'varchar', nullable: true })
  utmCampaign?: string | null;

  @Column({ name: 'delay_minutes', type: 'int', default: 60 })
  delayMinutes: number;

  @Column({ name: 'mode', type: 'varchar', default: 'manual' })
  mode: FollowupMode;

  @Column({ name: 'text', type: 'text', nullable: true })
  text?: string | null;

  // Desempate manual quando duas regras têm a mesma especificidade pro mesmo lead (menor = prioridade maior).
  @Column({ name: 'priority', type: 'int', default: 0 })
  priority: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
