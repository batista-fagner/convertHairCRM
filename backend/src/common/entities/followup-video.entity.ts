import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Biblioteca de vídeos reutilizáveis no follow-up. O vídeo fica no Supabase
// Storage (bucket sdr-followup-videos) e é enviado via URL pública pela uazapi.
@Entity('followup_videos')
export class FollowupVideo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  // Legenda padrão do vídeo (a regra pode sobrescrever com a dela).
  @Column({ name: 'caption', type: 'text', nullable: true })
  caption?: string | null;

  @Column({ name: 'storage_path', type: 'varchar' })
  storagePath: string;

  @Column({ name: 'public_url', type: 'varchar' })
  publicUrl: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
