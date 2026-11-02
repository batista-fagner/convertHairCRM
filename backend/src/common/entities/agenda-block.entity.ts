import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Exceção na agenda interna: um dia (ou algumas horas de um dia) em que não há
 * atendimento, mesmo que a disponibilidade semanal diga que sim — feriado,
 * viagem, compromisso pessoal.
 *
 * `date` é a data no fuso de Brasília em texto (YYYY-MM-DD), não timestamp, pra
 * não sofrer com conversão de fuso: "dia 25" é o dia 25 aqui, sempre.
 * `hours` vazio/null = o dia inteiro está bloqueado.
 */
@Entity('agenda_blocks')
export class AgendaBlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'date', type: 'varchar', length: 10 })
  date: string;

  @Column({ name: 'hours', type: 'jsonb', nullable: true })
  hours: number[] | null;

  @Column({ name: 'note', type: 'varchar', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
