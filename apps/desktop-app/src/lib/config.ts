/** Backend origins. Overridable at build time via Vite env for packaging. */
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

export const REALTIME_URL =
  import.meta.env.VITE_REALTIME_URL ?? "http://localhost:3000";

export const HEARTBEAT_INTERVAL_MS = 5_000;

/** Prefix that identifies an owner master token. */
export const OWNER_TOKEN_PREFIX = "sso_";
