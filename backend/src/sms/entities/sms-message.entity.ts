import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import type { SmsDirection } from './sms-contact.entity';

export type SmsDeliveryStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'undelivered'
  | 'failed'
  | 'received';

/** Quem produziu a mensagem — define a cor da bolha na inbox. */
export type SmsMessageSource = 'contact' | 'ai' | 'operator' | 'system';

@Entity('sms_messages')
@Index(['contactId', 'createdAt'])
export class SmsMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK lógica — este projeto não usa relations do TypeORM (ver `Lead.campaignId`). */
  @Index()
  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  @Column({ name: 'direction', type: 'varchar' })
  direction: SmsDirection;

  @Column({ name: 'body', type: 'text' })
  body: string;

  @Column({ name: 'status', type: 'varchar', default: 'queued' })
  status: SmsDeliveryStatus;

  @Column({ name: 'source', type: 'varchar' })
  source: SmsMessageSource;

  @Column({ name: 'provider_name', type: 'varchar', default: 'mock' })
  providerName: string;

  /**
   * Unique de propósito: é o que garante deduplicação de verdade. O `Set` em
   * memória (padrão do SdrController) morre a cada restart do Railway e não
   * cobre múltiplas réplicas — o índice cobre.
   */
  @Column({ name: 'provider_message_id', type: 'varchar', unique: true, nullable: true })
  providerMessageId?: string;

  /** Status cru do provedor, antes do mapeamento — útil pra depurar integração. */
  @Column({ name: 'provider_status_raw', type: 'varchar', nullable: true })
  providerStatusRaw?: string;

  @Column({ name: 'error_code', type: 'varchar', nullable: true })
  errorCode?: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  /** Segmentos de SMS — custo é por segmento, não por mensagem. */
  @Column({ name: 'segments', type: 'int', nullable: true })
  segments?: number;

  @Column({ name: 'from_number', type: 'varchar', nullable: true })
  fromNumber?: string;

  @Column({ name: 'to_number', type: 'varchar', nullable: true })
  toNumber?: string;

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt?: Date;

  @Column({ name: 'delivered_at', type: 'timestamp', nullable: true })
  deliveredAt?: Date;

  @Column({ name: 'failed_at', type: 'timestamp', nullable: true })
  failedAt?: Date;

  /** Só inbound — quando o operador leu na tela. */
  @Column({ name: 'read_at', type: 'timestamp', nullable: true })
  readAt?: Date;

  @Column({ name: 'meta', type: 'jsonb', nullable: true })
  meta?: Record<string, unknown>;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
