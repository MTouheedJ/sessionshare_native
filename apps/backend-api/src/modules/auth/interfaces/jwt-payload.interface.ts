import { TokenType } from '../../../database/entities';

/** JWT issued to an owner/admin after dashboard login. */
export interface OwnerJwtPayload {
  sub: string;
  email: string;
  scope: 'owner';
}

/** Short-lived JWT issued to a desktop client after token validation. */
export interface DesktopJwtPayload {
  sub: string;
  ownerId: string;
  tokenType: TokenType;
  hwid: string;
  sessionId: string | null;
  scope: 'desktop';
}

/** Very short-lived ticket used only to open the dashboard WebSocket. */
export interface DashboardWsTicketPayload {
  sub: string;
  scope: 'dashboard-ws';
}

export type JwtPayload =
  OwnerJwtPayload | DesktopJwtPayload | DashboardWsTicketPayload;

/** Request identity resolved from a desktop JWT. */
export interface DesktopIdentity {
  tokenId: string;
  tokenType: TokenType;
  ownerId: string;
  hwid: string;
  sessionId: string | null;
}

export interface AuthenticatedOwner {
  id: string;
  email: string;
}
