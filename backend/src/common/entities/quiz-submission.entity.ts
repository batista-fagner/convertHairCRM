import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Registro permanente de cada quiz respondido até o fim — gravado no momento
// do submit (QuizService.submit), independente de a pessoa depois entrar ou
// não no grupo do WhatsApp. Existe porque as respostas por si só só viravam
// permanentes via a fila do TrackingService (Redis, TTL de 2min) quando a
// pessoa entrava no grupo — quem terminava o quiz mas nunca entrava perdia o
// dado pra sempre. Guarda UTM/fbclid completos pra atribuição por
// campanha/conjunto/anúncio, sem depender do lead ter telefone ainda.
@Entity('quiz_submissions')
export class QuizSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quiz_id', type: 'uuid' })
  quizId: string;

  @Column({ name: 'quiz_slug', type: 'varchar' })
  quizSlug: string;

  @Column({ name: 'quiz_name', type: 'varchar' })
  quizName: string;

  @Column({ name: 'answers', type: 'jsonb' })
  answers: { question: string; answer: string }[];

  @Column({ name: 'mql_events', type: 'jsonb', nullable: true })
  mqlEvents?: string[] | null;

  @Column({ name: 'utm_source', type: 'varchar', nullable: true })
  utmSource?: string;

  @Column({ name: 'utm_medium', type: 'varchar', nullable: true })
  utmMedium?: string;

  @Column({ name: 'utm_campaign', type: 'varchar', nullable: true })
  utmCampaign?: string;

  @Column({ name: 'utm_content', type: 'varchar', nullable: true })
  utmContent?: string;

  @Column({ name: 'utm_term', type: 'varchar', nullable: true })
  utmTerm?: string;

  @Column({ name: 'fbclid', type: 'varchar', nullable: true })
  fbclid?: string;

  @Column({ name: 'fbc', type: 'varchar', nullable: true })
  fbc?: string;

  @Column({ name: 'fbp', type: 'varchar', nullable: true })
  fbp?: string;

  @Column({ name: 'click_id', type: 'varchar', nullable: true })
  clickId?: string;

  @Column({ name: 'user_agent', type: 'varchar', nullable: true })
  userAgent?: string;

  @Column({ name: 'client_ip', type: 'varchar', nullable: true })
  clientIp?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
