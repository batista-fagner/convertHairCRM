import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type CarouselStatus = 'draft' | 'text_ready';

export interface SlideData {
  index: number;
  text: string;
}

// Carrossel de Instagram no formato "print de tweet" (fundo branco, texto preto).
// Aqui só existe TEXTO — a imagem de cada slide é gerada fora, por outra ferramenta.
// Foi por isso que a versão antiga desse módulo foi removida (a254a2d): ela dependia
// de puppeteer pra renderizar slide, e o Chromium (~577MB) quebrava o build no Railway.
@Entity('carousels')
export class Carousel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  topic: string;

  // Ângulo narrativo (contraintuitivo, erros, bastidor...) — ver ANGLES no service.
  // É a ESTRUTURA da história; o tom é só como ela soa.
  @Column({ type: 'varchar', default: 'passo_a_passo' })
  angle: string;

  @Column({ type: 'varchar' })
  tone: string;

  // Quem precisa parar o scroll. É o que separa "viralizar pra qualquer um" de
  // "atrair seguidor qualificado" — a IA escreve no vocabulário dessa pessoa.
  @Column({ type: 'text', nullable: true })
  audience: string | null;

  @Column({ name: 'slide_count', type: 'int' })
  slideCount: number;

  @Column({ type: 'varchar', default: 'draft' })
  status: CarouselStatus;

  @Column({ name: 'instagram_handle', type: 'varchar', nullable: true })
  instagramHandle: string | null;

  @Column({ type: 'jsonb', default: [] })
  slides: SlideData[];

  // Legenda do post (campo de caption do Instagram) + hashtags do nicho.
  @Column({ type: 'text', nullable: true })
  caption: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
