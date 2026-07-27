import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type SmsContactStatus = 'active' | 'opted_out' | 'invalid' | 'archived';
export type SmsDirection = 'inbound' | 'outbound';

/**
 * Aluna mentorada do programa (EUA) que conversa pelo canal de SMS.
 *
 * Deliberadamente separado de `Lead`: essas pessoas não são leads do funil do
 * sócio e não podem aparecer no Kanban / /leads / Analytics, que varrem a
 * tabela `leads` inteira. Além disso `Lead.phone` é unique e o
 * `MessagingService.normalizePhone()` força prefixo 55 (Brasil).
 *
 * Não existe `aiContext` aqui de propósito — o histórico canônico é a tabela
 * `sms_messages`, o que evita o read-modify-write do array jsonb (que tem race
 * real entre o webhook e o operador) e permite status de entrega por mensagem.
 */
@Entity('sms_contacts')
@Index(['status', 'lastMessageAt'])
export class SmsContact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Sempre E.164 (+1XXXXXXXXXX). Ver `toE164Us()`. */
  @Column({ name: 'phone', type: 'varchar', unique: true })
  phone: string;

  @Column({ name: 'name', type: 'varchar', nullable: true })
  name?: string;

  @Column({ name: 'email', type: 'varchar', nullable: true })
  email?: string;

  /** Id da aluna no sistema do cliente — torna o import de CSV idempotente. */
  @Index()
  @Column({ name: 'external_id', type: 'varchar', nullable: true })
  externalId?: string;

  /** Usado para quiet hours (TCPA) — a base é espalhada por vários fusos dos EUA. */
  @Column({ name: 'timezone', type: 'varchar', default: 'America/New_York' })
  timezone: string;

  /** Turma da mentoria, ex. "Cohort 12". */
  @Column({ name: 'cohort', type: 'varchar', nullable: true })
  cohort?: string;

  /** Etapa do programa (onboarding, week1, graduated...). Nada a ver com o Kanban de leads. */
  @Column({ name: 'program_stage', type: 'varchar', nullable: true })
  programStage?: string;

  @Column({ name: 'tags', type: 'jsonb', nullable: true })
  tags?: string[];

  /**
   * Campos livres do programa (`{ module: 3, totalModules: 8, lastTask: 'done' }`).
   * Genérico de propósito: se o cliente mudar a estrutura do programa, não mexe em código.
   */
  @Column({ name: 'attributes', type: 'jsonb', nullable: true })
  attributes?: Record<string, unknown>;

  /** Operador assumiu a conversa — a IA para de responder (mesma semântica de `Lead.aiPaused`). */
  @Column({ name: 'ai_paused', type: 'boolean', default: false })
  aiPaused: boolean;

  // --- Compliance TCPA ---

  @Column({ name: 'opted_out', type: 'boolean', default: false })
  optedOut: boolean;

  @Column({ name: 'opted_out_at', type: 'timestamp', nullable: true })
  optedOutAt?: Date;

  /** Qual palavra disparou o opt-out — é a prova de compliance. */
  @Column({ name: 'opt_out_keyword', type: 'varchar', nullable: true })
  optOutKeyword?: string;

  @Column({ name: 'consent_source', type: 'varchar', nullable: true })
  consentSource?: string;

  @Column({ name: 'consent_at', type: 'timestamp', nullable: true })
  consentAt?: Date;

  @Column({ name: 'status', type: 'varchar', default: 'active' })
  status: SmsContactStatus;

  // --- Denormalizado para a lista de conversas (evita N+1 / join) ---

  @Index()
  @Column({ name: 'last_message_at', type: 'timestamp', nullable: true })
  lastMessageAt?: Date;

  @Column({ name: 'last_message_preview', type: 'varchar', length: 280, nullable: true })
  lastMessagePreview?: string;

  @Column({ name: 'last_message_direction', type: 'varchar', nullable: true })
  lastMessageDirection?: SmsDirection;

  @Column({ name: 'unread_count', type: 'int', default: 0 })
  unreadCount: number;

  @Column({ name: 'assigned_to', type: 'varchar', nullable: true })
  assignedTo?: string;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
