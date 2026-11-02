import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Disponibilidade recorrente da agenda interna (tela /agenda do CRM): uma
 * linha por dia da semana, com as horas cheias livres naquele dia.
 *
 * É a fonte dos horários que o Efraim oferece no WhatsApp — antes disso ele
 * sorteava horários (computeSlots). Horário já ocupado (leads.meeting_at) e
 * data bloqueada (AgendaBlock) são descontados em runtime, não aqui.
 */
@Entity('agenda_availability')
export class AgendaAvailability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 0 = domingo … 6 = sábado (mesmo índice de Date.getDay no fuso de Brasília). */
  @Column({ name: 'weekday', type: 'int', unique: true })
  weekday: number;

  /** Horas cheias livres nesse dia, ex.: [10, 11, 14, 15, 16]. Vazio = dia sem atendimento. */
  @Column({ name: 'hours', type: 'jsonb', default: () => "'[]'" })
  hours: number[];

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
