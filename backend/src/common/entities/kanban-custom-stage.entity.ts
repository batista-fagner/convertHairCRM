import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Raia do Kanban criada pelo usuário (ex.: "Atendimento pelo SDR",
 * "Agendamentos") — complementa as raias fixas de KANBAN_STAGES sem entrar
 * nesse enum, porque seu conjunto de valores só existe em runtime. A IA nunca
 * produz uma dessas (deriveKanbanStage em sdr.service.ts só conhece as fixas)
 * — só chegam aqui por drag-and-drop manual no Kanban.
 *
 * `stageKey` é o valor gravado em `leads.kanban_stage` e nunca muda depois de
 * criado (mesmo que o título seja renomeado depois) — senão todo lead que já
 * está na raia ficaria "órfão" (kanban_stage apontando pra uma chave que não
 * existe mais em nenhum lugar).
 */
@Entity('kanban_custom_stages')
export class KanbanCustomStage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'stage_key', type: 'varchar', unique: true })
  stageKey: string;

  @Column({ name: 'title', type: 'varchar' })
  title: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
