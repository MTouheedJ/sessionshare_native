import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { QueryFailedError, Repository } from 'typeorm';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import { User } from '../../database/entities';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  DashboardWsTicketPayload,
  OwnerJwtPayload,
} from './interfaces/jwt-payload.interface';

const BCRYPT_ROUNDS = 12;
const PG_UNIQUE_VIOLATION = '23505';
// Compared against when the email is unknown, so response timing doesn't leak account existence.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-password', BCRYPT_ROUNDS);

export interface OwnerProfile {
  id: string;
  email: string;
  fullName: string | null;
  createdAt: Date;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: 'Bearer';
  owner: OwnerProfile;
}

export interface WsTicketResponse {
  ticket: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    let owner: User;
    try {
      owner = await this.users.save(
        this.users.create({
          email: dto.email,
          passwordHash,
          fullName: dto.fullName ?? null,
        }),
      );
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
    return this.buildResponse(owner);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const owner = await this.users
      .createQueryBuilder('owner')
      .addSelect('owner.passwordHash')
      .where('owner.email = :email', { email: dto.email })
      .getOne();

    const valid = await bcrypt.compare(
      dto.password,
      owner?.passwordHash ?? DUMMY_HASH,
    );
    if (!owner || !valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.buildResponse(owner);
  }

  async issueWsTicket(ownerId: string): Promise<WsTicketResponse> {
    const payload: DashboardWsTicketPayload = {
      sub: ownerId,
      scope: 'dashboard-ws',
    };
    const expiresIn = this.config.jwt.wsTicketExpiresInSeconds;
    return {
      ticket: await this.jwt.signAsync(payload, { expiresIn }),
      expiresIn,
    };
  }

  private async buildResponse(owner: User): Promise<AuthResponse> {
    const payload: OwnerJwtPayload = {
      sub: owner.id,
      email: owner.email,
      scope: 'owner',
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      tokenType: 'Bearer',
      owner: {
        id: owner.id,
        email: owner.email,
        fullName: owner.fullName,
        createdAt: owner.createdAt,
      },
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError: unknown = error.driverError;
  return (
    typeof driverError === 'object' &&
    driverError !== null &&
    'code' in driverError &&
    driverError.code === PG_UNIQUE_VIOLATION
  );
}
