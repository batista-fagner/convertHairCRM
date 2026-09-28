import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Raia customizada do Kanban de cold call, criada pelo usuário — mesmo
 * padrão do KanbanCustomStage (Kanban de leads do WhatsApp), só que uma
 * tabela própria pra não misturar os dois Kanbans (são domínios diferentes:
 * leads de WhatsApp vs. prospects de cold call B2B).
 *
 * `stageKey` nunca muda depois de criado — é o valor gravado em
 * coldcall_leads.kanban_stage, trocar o slug no rename deixaria todo
 * prospect já nessa raia "órfão".
 */
@Entity('coldcall_stages')
export class ColdCallStage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'stage_key', type: 'varchar', unique: true })
  stageKey: string;

  @Column({ name: 'title', type: 'varchar' })
  title: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
