import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type AudioAssetKind = 'music' | 'sfx';

// Biblioteca de áudio do editor de vídeo: trilhas de fundo (`music`) e efeitos
// de transição (`sfx`). Sobe uma vez, reusa em qualquer edição — o EditPlan
// guarda só o id, e o backend resolve a URL pública dentro do plano antes de
// mandar pro preview/render (a composição Remotion não consulta banco).
//
// Fica no R2 (mesmo bucket do resto), não no Supabase Storage — diferente da
// FollowupVideo, que é mais antiga. O R2 é o que o serviço de render já usa.
@Entity('audio_assets')
export class AudioAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'kind', type: 'varchar', default: 'music' })
  kind: AudioAssetKind;

  @Column({ name: 'storage_path', type: 'varchar' })
  storagePath: string;

  @Column({ name: 'public_url', type: 'varchar' })
  publicUrl: string;

  // Medida no navegador antes do upload (elemento <audio>) — só pra exibir
  // "0:38" na lista e pra calcular fade da trilha. Nullable porque nem todo
  // formato reporta duração de forma confiável antes do fim do carregamento.
  @Column({ name: 'duration_sec', type: 'float', nullable: true })
  durationSec?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
