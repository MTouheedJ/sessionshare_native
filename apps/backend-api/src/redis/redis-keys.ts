/** Redis key / channel names. See docs/database_schema.md §2. */
export const RedisKeys = {
  /** Presence hash per bound device session; expires when heartbeats stop. */
  presence: (sessionId: string): string => `presence:session:${sessionId}`,
  tokenStatus: (tokenId: string): string => `token:status:${tokenId}`,
} as const;

export const RedisChannels = {
  /** Admin actions targeting desktop clients. */
  sessionEvents: 'pubsub:session_events',
  /** Live updates for owner dashboards. */
  dashboardEvents: 'pubsub:dashboard_events',
} as const;

export const PRESENCE_TTL_SECONDS = 15;
