import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Auditoria de Instagram (prospecção ativa): o sócio escolhe um perfil de
 * mega hair, o CRM coleta os dados (Scrape Creators + Biblioteca de Anúncios),
 * a IA monta o diagnóstico e ele gera o PDF pra mandar pro prospect antes de
 * ligar. Uma linha por análise — reanalisar o mesmo @ cria outra.
 */
@Entity('ig_audits')
export class IgAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'username', type: 'varchar' })
  username: string;

  /** running → coletando/analisando; ok; error (ver `error`). */
  @Column({ name: 'status', type: 'varchar', default: 'running' })
  status: 'running' | 'ok' | 'error';

  /** Etapa curta do que está rodando agora (mostrada na tela enquanto analisa). */
  @Column({ name: 'progress', type: 'varchar', nullable: true })
  progress?: string | null;

  /** Funil comercial: analisado → pdf-enviado → ligacao-feita (ou reuniao-marcada / sem-interesse). */
  @Column({ name: 'stage', type: 'varchar', default: 'analisado' })
  stage: string;

  /** Dados coletados (perfil, reels, destaques, anúncios, site) — fatos, sem IA. */
  @Column({ name: 'data', type: 'jsonb', nullable: true })
  data?: any;

  /** Resultado da IA no formato fixo (notas, erros, oportunidades, plano, capa do PDF). */
  @Column({ name: 'analysis', type: 'jsonb', nullable: true })
  analysis?: any;

  @Column({ name: 'error', type: 'text', nullable: true })
  error?: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null;

  @Column({ name: 'created_by', type: 'varchar', nullable: true })
  createdBy?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
