import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

/** Encrypted owner session profile (one per owner). Maps to the `session_vault` table. */
@Entity({ name: 'session_vault' })
export class SessionVault {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid', unique: true })
  ownerId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  /** `v1:` + base64(iv[12] | authTag[16] | ciphertext), AES-256-GCM. */
  @Column({ name: 'encrypted_payload', type: 'text' })
  encryptedPayload: string;

  /** SHA-256 (hex) of the plaintext payload. */
  @Column({ type: 'varchar', length: 64 })
  checksum: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
