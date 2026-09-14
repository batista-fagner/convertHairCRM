import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Um perfil do Instagram que recebeu reply de story na prospecção ativa (ConvertIQ). */
@Entity('prospects')
export class Prospect {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'username' })
  username: string;

  @Column({ name: 'full_name', nullable: true })
  fullName?: string;

  // Perfil semente de onde essa sugestão veio — permite reconstruir a corrente.
  @Column({ name: 'seed_username', nullable: true })
  seedUsername?: string;

  @Column({ name: 'message', type: 'text' })
  message: string;

  @Column({ name: 'sent_at', type: 'timestamptz' })
  sentAt: Date;

  @Column({ name: 'responded', type: 'boolean', default: false })
  responded: boolean;

  @Column({ name: 'replied_at', type: 'timestamptz', nullable: true })
  repliedAt?: Date | null;

  // Marcado quando o usuário escolhe esse prospect como próxima semente na tela de Prospecção.
  @Column({ name: 'promoted_to_seed', type: 'boolean', default: false })
  promotedToSeed: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
