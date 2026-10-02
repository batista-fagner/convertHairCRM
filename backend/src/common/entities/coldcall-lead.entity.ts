import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Raias fixas do Kanban de cold call — igual ao padrão de KANBAN_STAGES do
// Lead (leads/kanban-lead do WhatsApp): fixas + raias customizadas criadas
// pelo usuário direto no Kanban (ColdCallStage), unidas em runtime.
export const COLDCALL_STAGES = ['novo', 'tentando-contato', 'sem-resposta', 'agendado', 'nao-interessado', 'fechado'] as const;
export type ColdCallStageKey = (typeof COLDCALL_STAGES)[number];

/** Um prospect B2B pra cold call, importado via CSV (ver ColdCallService.importCsv). */
@Entity('coldcall_leads')
export class ColdCallLead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_name', type: 'varchar' })
  companyName: string;

  @Column({ name: 'city', type: 'varchar', nullable: true })
  city?: string | null;

  @Column({ name: 'state', type: 'varchar', nullable: true })
  state?: string | null;

  // Formato E.164 (+5592...) — usado direto no link tel: do card.
  @Column({ name: 'phone', type: 'varchar', nullable: true })
  phone?: string | null;

  @Column({ name: 'email', type: 'varchar', nullable: true })
  email?: string | null;

  @Column({ name: 'website', type: 'varchar', nullable: true })
  website?: string | null;

  @Column({ name: 'source_url', type: 'varchar', nullable: true })
  sourceUrl?: string | null;

  // Texto livre do lote de importação explicando por que esse contato
  // qualifica como B2B (vem pronto no CSV, só exibido, nunca editado aqui).
  @Column({ name: 'b2b_evidence', type: 'text', nullable: true })
  b2bEvidence?: string | null;

  // Nome da lista/lote de origem (ex.: "Dedetizadoras", "Sem site") — dado na
  // importação do CSV, usado só pra filtrar o Kanban. null = import antigo
  // (o script de migração marcou os existentes).
  @Column({ name: 'list_name', type: 'varchar', nullable: true })
  listName?: string | null;

  // Enriquecimento opcional do CSV (Google Maps / levantamento manual).
  @Column({ name: 'google_rating', type: 'real', nullable: true })
  googleRating?: number | null;

  @Column({ name: 'google_reviews', type: 'int', nullable: true })
  googleReviews?: number | null;

  @Column({ name: 'neighborhood', type: 'varchar', nullable: true })
  neighborhood?: string | null;

  @Column({ name: 'kanban_stage', type: 'varchar', default: 'novo' })
  kanbanStage: string;

  @Column({ name: 'assigned_to', type: 'varchar', nullable: true })
  assignedTo?: string | null;

  // Próximo horário combinado pra ligar — um valor só, sempre sobrescrito
  // (v1 não guarda histórico de tentativas, ver memória do módulo).
  @Column({ name: 'next_contact_at', type: 'timestamp', nullable: true })
  nextContactAt?: Date | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
