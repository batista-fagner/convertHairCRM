import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

// Rastreio de progresso do quiz público — EXISTE SEPARADO de quiz_submissions
// de propósito: quiz_submissions é o log permanente de quem terminou (nunca
// atualizado, só inserido, dado histórico intocável), enquanto aqui é uma
// linha por sessão (quizId + clickId) que vai sendo atualizada conforme a
// pessoa responde, pra dar pra ver ONDE ela abandonou — coisa que hoje não
// existe (quem não termina não deixa rastro nenhum).
//
// completed=true quando a pessoa chega na tela final (ver QuizService.submit,
// que atualiza essa mesma linha em paralelo ao insert em quiz_submissions —
// nunca o contrário). furthestQuestionIndex é o índice (0-based) da última
// pergunta respondida; -1 = abriu o quiz mas não respondeu nenhuma pergunta.
@Entity('quiz_progress')
@Unique(['quizId', 'clickId'])
export class QuizProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quiz_id', type: 'uuid' })
  quizId: string;

  @Column({ name: 'quiz_slug', type: 'varchar' })
  quizSlug: string;

  @Column({ name: 'click_id', type: 'varchar' })
  clickId: string;

  @Column({ name: 'furthest_question_index', type: 'int', default: -1 })
  furthestQuestionIndex: number;

  @Column({ name: 'total_questions', type: 'int' })
  totalQuestions: number;

  @Column({ name: 'answers', type: 'jsonb', default: '[]' })
  answers: { questionIndex: number; question: string; answer: string }[];

  @Column({ name: 'completed', type: 'boolean', default: false })
  completed: boolean;

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
