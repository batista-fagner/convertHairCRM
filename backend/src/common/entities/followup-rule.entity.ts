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

  // Título do anúncio (ctwa_ad_title) — filtra por criativo específico. Nulo = qualquer criativo.
  @Column({ name: 'ad_title', type: 'varchar', nullable: true })
  adTitle?: string | null;

  // Só casa com leads criados a partir desta data/hora. Nulo = sem filtro de data.
  // Usado pra restringir uma regra aos leads que estão chegando agora (ex: "hoje"),
  // sem afetar leads antigos já parados na mesma raia.
  @Column({ name: 'created_after', type: 'timestamp', nullable: true })
  createdAfter?: Date | null;

  @Column({ name: 'delay_minutes', type: 'int', default: 60 })
  delayMinutes: number;

  @Column({ name: 'mode', type: 'varchar', default: 'manual' })
  mode: FollowupMode;

  @Column({ name: 'text', type: 'text', nullable: true })
  text?: string | null;

  // Se preenchido, a regra manda esse vídeo (com legenda) em vez de texto —
  // o mode/text passam a ser ignorados. FK lógica pro FollowupVideo.
  @Column({ name: 'video_id', type: 'uuid', nullable: true })
  videoId?: string | null;

  // Legenda específica desta regra; se null, usa a caption padrão do vídeo.
  @Column({ name: 'video_caption_override', type: 'text', nullable: true })
  videoCaptionOverride?: string | null;

  // Desempate manual quando duas regras têm a mesma especificidade pro mesmo lead (menor = prioridade maior).
  @Column({ name: 'priority', type: 'int', default: 0 })
  priority: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
