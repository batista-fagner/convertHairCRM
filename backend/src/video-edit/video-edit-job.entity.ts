import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import type { EditPlan, EditPlanTranscript } from './edit-plan.types';

// Status machine: uploaded -> preparing -> audio_ready -> transcribing ->
// planning -> plan_ready -> queued -> rendering -> done (+ failed a partir de
// qualquer estado).
//
// Quem escreve cada transição:
//   uploaded          — este backend, ao criar o job (create())
//   preparing/audio_ready — o serviço de render (video-edit-prepare), via
//                           UPDATE cru em Postgres — NUNCA TypeORM/synchronize
//                           dos dois lados na mesma tabela é risco real de dado.
//   transcribing/planning/plan_ready/failed — este backend, no consumidor de
//                           video-edit-analyze (video-edit-queue.processor.ts)
//   queued/rendering/done — entram na Etapa 5 (render de verdade)
export type VideoEditJobStatus =
  | 'uploaded'
  | 'preparing'
  | 'audio_ready'
  | 'transcribing'
  | 'planning'
  | 'plan_ready'
  | 'queued'
  | 'rendering'
  | 'done'
  | 'failed';

@Entity('video_edit_jobs')
export class VideoEditJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  // Instrução em português escrita pelo usuário — o que a IA lê junto da
  // transcrição pra montar o plano.
  @Column({ name: 'instruction', type: 'text' })
  instruction: string;

  @Column({ name: 'status', type: 'varchar', default: 'uploaded' })
  status: VideoEditJobStatus;

  @Column({ name: 'source_storage_path', type: 'varchar' })
  sourceStoragePath: string;

  @Column({ name: 'source_url', type: 'varchar' })
  sourceUrl: string;

  @Column({ name: 'norm_storage_path', type: 'varchar', nullable: true })
  normStoragePath?: string | null;

  @Column({ name: 'norm_url', type: 'varchar', nullable: true })
  normUrl?: string | null;

  @Column({ name: 'audio_storage_path', type: 'varchar', nullable: true })
  audioStoragePath?: string | null;

  @Column({ name: 'audio_url', type: 'varchar', nullable: true })
  audioUrl?: string | null;

  @Column({ name: 'src_duration_sec', type: 'float', nullable: true })
  srcDurationSec?: number | null;

  @Column({ name: 'src_width', type: 'int', nullable: true })
  srcWidth?: number | null;

  @Column({ name: 'src_height', type: 'int', nullable: true })
  srcHeight?: number | null;

  // { text, words: [{word,start,end}], segments, language, duration } — saída
  // crua do Whisper, guardada pra permitir re-planejar (POST /:id/replan, Etapa
  // 6) sem transcrever de novo.
  @Column({ name: 'transcript', type: 'jsonb', nullable: true })
  transcript?: EditPlanTranscript | null;

  // O EditPlan completo — mesmo formato que frontend/src/remotion consome no
  // preview e o serviço de render consome pra renderizar. Ver edit-plan.types.ts.
  @Column({ name: 'plan', type: 'jsonb', nullable: true })
  plan?: EditPlan | null;

  @Column({ name: 'plan_model', type: 'varchar', nullable: true })
  planModel?: string | null;

  @Column({ name: 'output_storage_path', type: 'varchar', nullable: true })
  outputStoragePath?: string | null;

  @Column({ name: 'output_url', type: 'varchar', nullable: true })
  outputUrl?: string | null;

  // 0-100 — atualizado pelo serviço de render durante o preparo/render (UPDATE
  // cru), lido pelo frontend via polling.
  @Column({ name: 'progress', type: 'int', default: 0 })
  progress: number;

  // Rótulo curto do que está acontecendo agora ("normalizando", "transcrevendo",
  // "compondo cena") — mostrado na tela de progresso.
  @Column({ name: 'stage', type: 'varchar', nullable: true })
  stage?: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null;

  @Column({ name: 'render_started_at', type: 'timestamptz', nullable: true })
  renderStartedAt?: Date | null;

  @Column({ name: 'render_finished_at', type: 'timestamptz', nullable: true })
  renderFinishedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
