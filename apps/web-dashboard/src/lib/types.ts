/** Mirrors of the backend-api response shapes. */

export type TokenStatus = "ACTIVE" | "PAUSED" | "REVOKED" | "EXPIRED";
export type SessionStatus = "ONLINE" | "OFFLINE" | "BLOCKED";
export type TokenType = "OWNER" | "USER";

export interface DeviceBinding {
  sessionId: string;
  hwid: string;
  status: SessionStatus;
  ipAddress: string | null;
  clientVersion: string | null;
  connectedAt: string;
  lastHeartbeat: string;
}

export interface UserToken {
  id: string;
  token: string;
  status: TokenStatus;
  maxUses: number;
  currentUses: number;
  remainingUses: number;
  expiresAt: string | null;
  createdAt: string;
  devices: DeviceBinding[];
}

export interface OwnerToken {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface OwnerTokenCreated extends OwnerToken {
  token: string;
}

export interface Session {
  id: string;
  tokenId: string;
  token: string;
  tokenStatus: TokenStatus;
  hwid: string;
  ipAddress: string | null;
  clientVersion: string | null;
  status: SessionStatus;
  connectedAt: string;
  lastHeartbeat: string;
  disconnectedAt: string | null;
}

export interface OwnerSession {
  id: string;
  email: string;
  expiresAt: number;
}

export type DashboardEvent =
  | { type: "session.updated"; sessionId: string; tokenId: string | null; status: SessionStatus }
  | { type: "session.heartbeat"; sessionId: string; tokenId: string; lastHeartbeat: string; ipAddress: string | null }
  | { type: "token.updated"; tokenId: string; tokenType: TokenType }
  | { type: "token.deleted"; tokenId: string; tokenType: TokenType };
