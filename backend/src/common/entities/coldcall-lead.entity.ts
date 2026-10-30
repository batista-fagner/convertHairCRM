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

  // Levantamento de porte (lista de integradoras solares, 2026-10-28) — base
  // pra mensagem personalizada. Tudo opcional; listas antigas não têm.
  @Column({ name: 'instagram', type: 'varchar', nullable: true })
  instagram?: string | null;

  @Column({ name: 'instagram_followers', type: 'int', nullable: true })
  instagramFollowers?: number | null;

  @Column({ name: 'meta_active_ads', type: 'int', nullable: true })
  metaActiveAds?: number | null;

  // "Forte" | "Indício" — força do sinal de que existe equipe comercial.
  @Column({ name: 'sales_team', type: 'varchar', nullable: true })
  salesTeam?: string | null;

  @Column({ name: 'sales_team_signal', type: 'text', nullable: true })
  salesTeamSignal?: string | null;

  @Column({ name: 'size_signals', type: 'text', nullable: true })
  sizeSignals?: string | null;

  // Frase de abertura sugerida pra ligação/mensagem.
  @Column({ name: 'call_hook', type: 'text', nullable: true })
  callHook?: string | null;

  @Column({ name: 'score', type: 'real', nullable: true })
  score?: number | null;

  // "A" | "B" | "C", derivada do score no levantamento.
  @Column({ name: 'priority', type: 'varchar', nullable: true })
  priority?: string | null;

  // Tags livres digitadas no card/modal (ex.: "dono atende", "ligar de manhã").
  @Column({ name: 'tags', type: 'jsonb', nullable: true })
  tags?: string[] | null;

  // Reunião agendada pelo card — espelhada num evento do Google Agenda.
  @Column({ name: 'meeting_at', type: 'timestamptz', nullable: true })
  meetingAt?: Date | null;

  @Column({ name: 'meeting_event_id', type: 'varchar', nullable: true })
  meetingEventId?: string | null;

  @Column({ name: 'meeting_link', type: 'varchar', nullable: true })
  meetingLink?: string | null;

  @Column({ name: 'meeting_invited', type: 'boolean', default: false })
  meetingInvited: boolean;

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
