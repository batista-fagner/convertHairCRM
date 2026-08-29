import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export interface QuizOption {
  id: string;
  label: string;
  // true = escolher essa opção conta como MQL para o evento configurado na
  // pergunta (isMqlQuestion + mqlEventName). Independente por opção — a mesma
  // pergunta pode ter respostas que qualificam e outras que não.
  isMqlAnswer?: boolean;
}

export interface QuizQuestion {
  id: string;
  order: number;
  question: string;
  // "pergunta matadora" — quando true, cada opção marcada isMqlAnswer dispara
  // o evento mqlEventName ao ser escolhida.
  isMqlQuestion?: boolean;
  mqlEventName?: string;
  options: QuizOption[];
}

export interface QuizPresentation {
  badgeTitle?: string;
  badgeSubtitle?: string;
  badgeDateLine?: string;
  photoUrl?: string;
  // altura máxima da foto em px — null/undefined usa o padrão do layout (340).
  photoMaxHeight?: number | null;
  title?: string;
  titleHighlight?: string;
  // tamanho da fonte do título em px — null/undefined usa o padrão do layout.
  titleFontSize?: number | null;
  subtitleBox?: string;
  subtitleBoxFontSize?: number | null;
  // trecho dentro de subtitleBox pra deixar com peso mais forte (font-black,
  // 900) que o resto do texto (que já é font-bold, 700).
  subtitleBoxBold?: string;
  bodyText?: string;
  bodyTextFontSize?: number | null;
  // trecho dentro de bodyText pra deixar com peso mais forte (font-black,
  // 900) que o resto do texto (que é normal, sem peso extra).
  bodyTextBold?: string;
  buttonLabel?: string;
  // segundos até redirecionar direto pro grupo se a pessoa não clicar no
  // botão da apresentação. null/0 = sem auto-redirect.
  autoRedirectSeconds?: number | null;
}

export interface QuizFinalStep {
  title?: string;
  titleHighlight?: string;
  progressLabel?: string;
  bodyText?: string;
  buttonLabel?: string;
  // segundos que a barra "Falta pouco!" leva animando até 100% na página
  // pública — o auto-redirect pro whatsappUrl dispara junto (ver Quiz.tsx no
  // repo da ConvertHairPage). O botão da tela final também redireciona a
  // qualquer momento, adiantando o auto-redirect.
  autoRedirectSeconds?: number | null;
}

// Quiz de captação (apresentação → até 6 perguntas de múltipla escolha, 1
// resposta por pergunta → tela final com botão pro grupo). Cada pergunta pode
// ser marcada como "MQL" com um nome de evento próprio (ex: MQL-workshop-1),
// disparado ao Meta via FacebookService.sendCustomEvent no momento da resposta
// (não espera o lead entrar no grupo) — é o que permite otimizar a campanha
// pelo evento de qualificação.
@Entity('quizzes')
export class Quiz {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'slug', type: 'varchar', unique: true })
  slug: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'whatsapp_url', type: 'varchar', nullable: true })
  whatsappUrl?: string | null;

  @Column({ name: 'presentation', type: 'jsonb' })
  presentation: QuizPresentation;

  @Column({ name: 'questions', type: 'jsonb', default: '[]' })
  questions: QuizQuestion[];

  @Column({ name: 'final_step', type: 'jsonb' })
  finalStep: QuizFinalStep;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
