import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserStatus } from './enums';
import { UserToken } from './user-token.entity';

/** Connected client session record. Maps to the `active_sessions` table. */
@Entity({ name: 'active_sessions' })
export class SessionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_token_id', type: 'uuid', nullable: true })
  userTokenId: string | null;

  @ManyToOne(() => UserToken, (token) => token.sessions, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'user_token_id' })
  userToken: UserToken | null;

  @Index('idx_active_sessions_hwid')
  @Column({ type: 'varchar', length: 255 })
  hwid: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({
    name: 'client_version',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  clientVersion: string | null;

  @Index('idx_active_sessions_status')
  @Column({
    type: 'enum',
    enum: UserStatus,
    enumName: 'user_status_enum',
    default: UserStatus.OFFLINE,
  })
  status: UserStatus;

  @Column({
    name: 'connected_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  connectedAt: Date;

  @Column({
    name: 'last_heartbeat',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  lastHeartbeat: Date;

  @Column({ name: 'disconnected_at', type: 'timestamptz', nullable: true })
  disconnectedAt: Date | null;
}
