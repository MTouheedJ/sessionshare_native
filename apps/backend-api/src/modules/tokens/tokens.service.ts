import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';
import {
  OwnerToken,
  SessionLog,
  TokenStatus,
  TokenType,
  UserStatus,
  UserToken,
} from '../../database/entities';
import { DesktopJwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RealtimeEventsService } from '../realtime/realtime-events.service';
import { SessionAction } from '../realtime/realtime.events';
import { TokenStatusService } from '../realtime/token-status.service';
import { CreateOwnerTokenDto } from './dto/create-owner-token.dto';
import { CreateUserTokenDto } from './dto/create-user-token.dto';
import { SettableStatus } from './dto/update-token-status.dto';
import { ValidateTokenDto } from './dto/validate-token.dto';
import {
  generateOwnerToken,
  generateUserToken,
  hashToken,
  OWNER_TOKEN_PREFIX,
} from './token-generator';

const HOUR_MS = 60 * 60 * 1000;

const ALLOWED_TRANSITIONS: Readonly<
  Record<TokenStatus, readonly TokenStatus[]>
> = {
  [TokenStatus.ACTIVE]: [TokenStatus.PAUSED, TokenStatus.REVOKED],
  [TokenStatus.PAUSED]: [TokenStatus.ACTIVE, TokenStatus.REVOKED],
  [TokenStatus.REVOKED]: [],
  [TokenStatus.EXPIRED]: [TokenStatus.REVOKED],
};

const STATUS_ACTION: Readonly<Record<SettableStatus, SessionAction>> = {
  [TokenStatus.ACTIVE]: SessionAction.RESUME,
  [TokenStatus.PAUSED]: SessionAction.PAUSE,
  [TokenStatus.REVOKED]: SessionAction.REVOKE,
};

export interface OwnerTokenView {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface OwnerTokenCreatedResponse extends OwnerTokenView {
  /** Plaintext token. Returned only once — not recoverable afterwards. */
  token: string;
}

export interface DeviceBindingView {
  sessionId: string;
  hwid: string;
  status: UserStatus;
  ipAddress: string | null;
  clientVersion: string | null;
  connectedAt: Date;
  lastHeartbeat: Date;
}

export interface UserTokenResponse {
  id: string;
  token: string;
  status: TokenStatus;
  maxUses: number;
  currentUses: number;
  remainingUses: number;
  expiresAt: Date | null;
  createdAt: Date;
  devices: DeviceBindingView[];
}

export interface ValidateTokenResponse {
  tokenType: TokenType;
  tokenId: string;
  ownerId: string;
  sessionId: string | null;
  accessToken: string;
  expiresIn: number;
}

interface ValidationContext {
  hwid: string;
  clientVersion: string | null;
  ipAddress: string | null;
}

type UserTokenOutcome =
  | { ok: true; token: UserToken; session: SessionLog }
  | { ok: false; error: UnauthorizedException | ForbiddenException };

@Injectable()
export class TokensService {
  constructor(
    @InjectRepository(OwnerToken)
    private readonly ownerTokens: Repository<OwnerToken>,
    @InjectRepository(UserToken)
    private readonly userTokens: Repository<UserToken>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly events: RealtimeEventsService,
    private readonly tokenStatus: TokenStatusService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ---------------------------------------------------------------- owner tokens

  async listOwnerTokens(ownerId: string): Promise<OwnerTokenView[]> {
    const tokens = await this.ownerTokens.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
    });
    return tokens.map(toOwnerTokenView);
  }

  async createOwnerToken(
    ownerId: string,
    dto: CreateOwnerTokenDto,
  ): Promise<OwnerTokenCreatedResponse> {
    const token = generateOwnerToken();
    const entity = await this.ownerTokens.save(
      this.ownerTokens.create({
        ownerId,
        tokenHash: hashToken(token),
        ...(dto.name !== undefined && { name: dto.name }),
      }),
    );
    await this.tokenStatus.set(entity.id, TokenStatus.ACTIVE);
    await this.notifyTokenChange(ownerId, entity.id, TokenType.OWNER);
    return { ...toOwnerTokenView(entity), token };
  }

  async revokeOwnerToken(ownerId: string, id: string): Promise<OwnerTokenView> {
    const entity = await this.ownerTokens.findOne({ where: { id, ownerId } });
    if (!entity) throw new NotFoundException('Token not found');
    if (entity.isActive) {
      entity.isActive = false;
      await this.ownerTokens.save(entity);
      await this.tokenStatus.set(entity.id, TokenStatus.REVOKED);
      await this.events.publishSession({
        action: SessionAction.REVOKE,
        ownerId,
        tokenId: entity.id,
        sessionId: null,
        reason: TokenStatus.REVOKED,
      });
      await this.notifyTokenChange(ownerId, entity.id, TokenType.OWNER);
    }
    return toOwnerTokenView(entity);
  }

  // ----------------------------------------------------------------- user tokens

  async listUserTokens(ownerId: string): Promise<UserTokenResponse[]> {
    const tokens = await this.userTokens.find({
      where: { ownerId },
      relations: { sessions: true },
      order: { createdAt: 'DESC' },
    });
    return tokens.map(toUserTokenResponse);
  }

  async createUserToken(
    ownerId: string,
    dto: CreateUserTokenDto,
  ): Promise<UserTokenResponse> {
    const expiresAt =
      dto.expiresInHours !== undefined
        ? new Date(Date.now() + dto.expiresInHours * HOUR_MS)
        : null;
    const entity = await this.userTokens.save(
      this.userTokens.create({
        ownerId,
        tokenValue: generateUserToken(),
        maxUses: dto.maxUses ?? 1,
        expiresAt,
      }),
    );
    entity.sessions = [];
    await this.tokenStatus.set(entity.id, entity.status);
    await this.notifyTokenChange(ownerId, entity.id, TokenType.USER);
    return toUserTokenResponse(entity);
  }

  async updateUserTokenStatus(
    ownerId: string,
    id: string,
    status: SettableStatus,
  ): Promise<UserTokenResponse> {
    const token = await this.findOwnedUserToken(ownerId, id);
    if (token.status === status) return toUserTokenResponse(token);

    if (
      status === TokenStatus.ACTIVE &&
      token.expiresAt &&
      token.expiresAt <= new Date()
    ) {
      throw new ConflictException('Token has expired and cannot be resumed');
    }
    if (!ALLOWED_TRANSITIONS[token.status].includes(status)) {
      throw new ConflictException(
        `Cannot change token from ${token.status} to ${status}`,
      );
    }

    token.status = status;
    await this.userTokens.update({ id: token.id }, { status });
    await this.tokenStatus.set(token.id, status);
    await this.events.publishSession({
      action: STATUS_ACTION[status],
      ownerId,
      tokenId: token.id,
      sessionId: null,
      reason: status,
    });
    await this.notifyTokenChange(ownerId, token.id, TokenType.USER);
    return toUserTokenResponse(token);
  }

  async deleteUserToken(ownerId: string, id: string): Promise<void> {
    const token = await this.findOwnedUserToken(ownerId, id);
    // Terminate first: connected clients are addressed by token room, which outlives the row.
    await this.tokenStatus.remove(token.id);
    await this.events.publishSession({
      action: SessionAction.REVOKE,
      ownerId,
      tokenId: token.id,
      sessionId: null,
      reason: 'DELETED',
    });
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        SessionLog,
        { userTokenId: token.id, status: UserStatus.ONLINE },
        { status: UserStatus.OFFLINE, disconnectedAt: new Date() },
      );
      await manager.delete(UserToken, { id: token.id });
    });
    await this.events.publishDashboard({
      type: 'token.deleted',
      ownerId,
      tokenId: token.id,
      tokenType: TokenType.USER,
    });
  }

  // ------------------------------------------------------------------ validation

  async validate(
    dto: ValidateTokenDto,
    ipAddress: string | null,
  ): Promise<ValidateTokenResponse> {
    const ctx: ValidationContext = {
      hwid: dto.hwid,
      clientVersion: dto.clientVersion ?? null,
      ipAddress,
    };
    return dto.token.startsWith(OWNER_TOKEN_PREFIX)
      ? this.validateOwnerToken(dto.token, ctx)
      : this.validateUserToken(dto.token, ctx);
  }

  private async validateOwnerToken(
    token: string,
    ctx: ValidationContext,
  ): Promise<ValidateTokenResponse> {
    const entity = await this.ownerTokens.findOne({
      where: { tokenHash: hashToken(token), isActive: true },
    });
    if (!entity) {
      throw new UnauthorizedException('Invalid token');
    }
    await this.ownerTokens.update(
      { id: entity.id },
      { lastUsedAt: new Date() },
    );
    return this.issueDesktopSession(
      TokenType.OWNER,
      entity.id,
      entity.ownerId,
      ctx.hwid,
      null,
    );
  }

  private async validateUserToken(
    token: string,
    ctx: ValidationContext,
  ): Promise<ValidateTokenResponse> {
    // Row lock serialises concurrent logins so HWID binding and use counting can't race.
    const outcome = await this.dataSource.transaction(
      (manager): Promise<UserTokenOutcome> =>
        this.bindUserToken(manager, token, ctx),
    );
    if (!outcome.ok) {
      throw outcome.error;
    }
    await this.events.publishDashboard({
      type: 'token.updated',
      ownerId: outcome.token.ownerId,
      tokenId: outcome.token.id,
      tokenType: TokenType.USER,
    });
    return this.issueDesktopSession(
      TokenType.USER,
      outcome.token.id,
      outcome.token.ownerId,
      ctx.hwid,
      outcome.session.id,
    );
  }

  /**
   * `max_uses` counts distinct HWID bindings. A device that is already bound re-validates
   * freely (refreshing its desktop JWT); only a new device consumes a use.
   * Returns failures instead of throwing so state changes (e.g. EXPIRED) still commit.
   */
  private async bindUserToken(
    manager: EntityManager,
    tokenValue: string,
    ctx: ValidationContext,
  ): Promise<UserTokenOutcome> {
    const tokens = manager.getRepository(UserToken);
    const sessions = manager.getRepository(SessionLog);

    const token = await tokens.findOne({
      where: { tokenValue },
      lock: { mode: 'pessimistic_write' },
    });
    if (!token) {
      return { ok: false, error: new UnauthorizedException('Invalid token') };
    }

    if (
      token.status === TokenStatus.ACTIVE &&
      token.expiresAt &&
      token.expiresAt <= new Date()
    ) {
      token.status = TokenStatus.EXPIRED;
      await tokens.save(token);
      await this.tokenStatus.set(token.id, TokenStatus.EXPIRED);
    }
    if (token.status !== TokenStatus.ACTIVE) {
      return {
        ok: false,
        error: new ForbiddenException(`Token is ${token.status}`),
      };
    }

    const existing = await sessions.findOne({
      where: { userTokenId: token.id, hwid: ctx.hwid },
    });
    if (existing) {
      if (existing.status === UserStatus.BLOCKED) {
        return {
          ok: false,
          error: new ForbiddenException('Device is blocked'),
        };
      }
      existing.ipAddress = ctx.ipAddress;
      if (ctx.clientVersion !== null)
        existing.clientVersion = ctx.clientVersion;
      await sessions.save(existing);
      return { ok: true, token, session: existing };
    }

    if (token.currentUses >= token.maxUses) {
      const message =
        token.maxUses === 1
          ? 'Token is bound to another device'
          : 'Token is bound to the maximum number of devices';
      return { ok: false, error: new ForbiddenException(message) };
    }

    token.currentUses += 1;
    await tokens.save(token);
    const session = await sessions.save(
      sessions.create({
        userTokenId: token.id,
        hwid: ctx.hwid,
        ipAddress: ctx.ipAddress,
        clientVersion: ctx.clientVersion,
        status: UserStatus.OFFLINE, // flips to ONLINE on WebSocket connect
      }),
    );
    return { ok: true, token, session };
  }

  // --------------------------------------------------------------------- helpers

  private async findOwnedUserToken(
    ownerId: string,
    id: string,
  ): Promise<UserToken> {
    const token = await this.userTokens.findOne({
      where: { id, ownerId },
      relations: { sessions: true },
    });
    if (!token) throw new NotFoundException('Token not found');
    return token;
  }

  private async notifyTokenChange(
    ownerId: string,
    tokenId: string,
    tokenType: TokenType,
  ): Promise<void> {
    await this.events.publishDashboard({
      type: 'token.updated',
      ownerId,
      tokenId,
      tokenType,
    });
  }

  private async issueDesktopSession(
    tokenType: TokenType,
    tokenId: string,
    ownerId: string,
    hwid: string,
    sessionId: string | null,
  ): Promise<ValidateTokenResponse> {
    const payload: DesktopJwtPayload = {
      sub: tokenId,
      ownerId,
      tokenType,
      hwid,
      sessionId,
      scope: 'desktop',
    };
    const expiresIn = this.config.jwt.desktopExpiresInSeconds;
    return {
      tokenType,
      tokenId,
      ownerId,
      sessionId,
      accessToken: await this.jwt.signAsync(payload, { expiresIn }),
      expiresIn,
    };
  }
}

function toOwnerTokenView(entity: OwnerToken): OwnerTokenView {
  return {
    id: entity.id,
    name: entity.name,
    isActive: entity.isActive,
    createdAt: entity.createdAt,
    lastUsedAt: entity.lastUsedAt,
  };
}

function toUserTokenResponse(entity: UserToken): UserTokenResponse {
  return {
    id: entity.id,
    token: entity.tokenValue,
    status: entity.status,
    maxUses: entity.maxUses,
    currentUses: entity.currentUses,
    remainingUses: Math.max(entity.maxUses - entity.currentUses, 0),
    expiresAt: entity.expiresAt,
    createdAt: entity.createdAt,
    devices: (entity.sessions ?? []).map((s) => ({
      sessionId: s.id,
      hwid: s.hwid,
      status: s.status,
      ipAddress: s.ipAddress,
      clientVersion: s.clientVersion,
      connectedAt: s.connectedAt,
      lastHeartbeat: s.lastHeartbeat,
    })),
  };
}
