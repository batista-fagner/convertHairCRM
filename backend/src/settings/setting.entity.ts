import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('settings')
export class Setting {
  @PrimaryColumn({ name: 'key', type: 'varchar' })
  key: string;

  @Column({ name: 'value', type: 'text', nullable: true })
  value?: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
