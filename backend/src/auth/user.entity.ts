import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type UserRole = 'socio' | 'sdr';

/**
 * Usuário do CRM (login por email + senha). `socio` vê tudo e gerencia
 * usuários; `sdr` só enxerga o Kanban (a restrição de telas é feita no front —
 * ver RequireRole em App.jsx).
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  email: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ name: 'password_hash', type: 'varchar', select: false })
  passwordHash: string;

  @Column({ type: 'varchar', default: 'sdr' })
  role: UserRole;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
