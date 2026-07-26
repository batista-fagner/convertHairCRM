import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type IgPostMediaType = 'IMAGE' | 'VIDEO';
export type IgPostStatus = 'scheduled' | 'processing' | 'published' | 'failed';

// Posts (imagem ou vídeo/reels) publicados no Instagram direto pelo CRM, com
// ou sem agendamento. O arquivo fica no Supabase Storage (bucket ig-posts) e
// é enviado por URL pública pro Content Publishing API do Instagram
// (graph.instagram.com). Vídeo processa de forma assíncrona no lado do
// Instagram — por isso o containerId + o cron que faz o polling do status
// em vez de publicar tudo numa chamada só (ver ig-posts.service.ts).
@Entity('ig_posts')
export class IgPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'media_type', type: 'varchar' })
  mediaType: IgPostMediaType;

  @Column({ name: 'caption', type: 'text', nullable: true })
  caption?: string | null;

  @Column({ name: 'storage_path', type: 'varchar' })
  storagePath: string;

  @Column({ name: 'public_url', type: 'varchar' })
  publicUrl: string;

  @Column({ name: 'status', type: 'varchar', default: 'scheduled' })
  status: IgPostStatus;

  // null = publica assim que o container terminar de processar (sem agendamento real)
  @Column({ name: 'scheduled_at', type: 'timestamp', nullable: true })
  scheduledAt?: Date | null;

  // creation_id do container de mídia no Instagram enquanto está processando
  @Column({ name: 'container_id', type: 'varchar', nullable: true })
  containerId?: string | null;

  // ID da mídia já publicada no Instagram
  @Column({ name: 'ig_media_id', type: 'varchar', nullable: true })
  igMediaId?: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null;

  // Tentativas de polling do status do container — corta o polling depois de
  // um tempo pra não ficar preso pra sempre num vídeo que travou no Instagram.
  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
