import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TokenStatus } from './enums';
import { SessionLog } from './session-log.entity';
import { User } from './user.entity';

@Entity({ name: 'user_tokens' })
export class UserToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_user_tokens_owner')
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => User, (owner) => owner.userTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Index('idx_user_tokens_value')
  @Column({ name: 'token_value', type: 'varchar', length: 64, unique: true })
  tokenValue: string;

  @Column({
    type: 'enum',
    enum: TokenStatus,
    enumName: 'token_status_enum',
    default: TokenStatus.ACTIVE,
  })
  status: TokenStatus;

  @Column({ name: 'max_uses', type: 'int', default: 1 })
  maxUses: number;

  @Column({ name: 'current_uses', type: 'int', default: 0 })
  currentUses: number;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => SessionLog, (session) => session.userToken)
  sessions: SessionLog[];
}
