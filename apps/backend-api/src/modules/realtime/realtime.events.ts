import { TokenType, UserStatus } from '../../database/entities';

/** Admin action routed to desktop clients via `pubsub:session_events`. */
export enum SessionAction {
  PAUSE = 'PAUSE',
  RESUME = 'RESUME',
  REVOKE = 'REVOKE',
  TERMINATE = 'TERMINATE',
}

export interface SessionEvent {
  action: SessionAction;
  ownerId: string;
  /** Targets every connection of the token when `sessionId` is null. */
  tokenId: string | null;
  sessionId: string | null;
  reason: string;
  at: string;
}

/** Live update routed to owner dashboards via `pubsub:dashboard_events`. */
export type DashboardEvent =
  | {
      type: 'session.updated';
      ownerId: string;
      sessionId: string;
      tokenId: string | null;
      status: UserStatus;
    }
  | {
      type: 'session.heartbeat';
      ownerId: string;
      sessionId: string;
      tokenId: string;
      lastHeartbeat: string;
      ipAddress: string | null;
    }
  | {
      type: 'token.updated';
      ownerId: string;
      tokenId: string;
      tokenType: TokenType;
    }
  | {
      type: 'token.deleted';
      ownerId: string;
      tokenId: string;
      tokenType: TokenType;
    };

/** Payload pushed to desktop clients on pause / resume / terminate. */
export interface DesktopControlPayload {
  tokenId: string | null;
  sessionId: string | null;
  reason: string;
  at: string;
}

export const DesktopServerEvents = {
  connectionAck: 'server:connection_ack',
  pause: 'server:pause_session',
  resume: 'server:resume_session',
  terminate: 'server:terminate_session',
  error: 'server:error',
} as const;

export const DesktopClientEvents = {
  connect: 'client:connect',
  heartbeat: 'client:heartbeat',
} as const;

export const DASHBOARD_EVENT = 'dashboard:event';
export const HEARTBEAT_INTERVAL_MS = 5_000;
