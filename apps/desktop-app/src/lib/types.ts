export type TokenType = "OWNER" | "USER";

export interface ValidateTokenResponse {
  tokenType: TokenType;
  tokenId: string;
  ownerId: string;
  sessionId: string | null;
  accessToken: string;
  expiresIn: number;
}

export interface VaultApp {
  executable: string;
  args: string[];
  windowTitleHint?: string;
}

export interface VaultPolicy {
  captureProtection: boolean;
  blockClipboard: boolean;
}

export interface VaultFile {
  path: string;
  /** base64 */
  data: string;
}

export interface VaultPayload {
  version: 1;
  app: VaultApp;
  policy: VaultPolicy;
  files: VaultFile[];
}

export interface VaultFetchResponse {
  payload: VaultPayload;
  checksum: string;
  updatedAt: string;
}

export interface SandboxInfo {
  token_id: string;
  dir: string;
  files_written: number;
  pid: number | null;
}

/** Control payload pushed from the server on pause/resume/terminate. */
export interface DesktopControlPayload {
  tokenId: string | null;
  sessionId: string | null;
  reason: string;
  at: string;
}

export interface ConnectionAck {
  tokenId: string;
  tokenType: TokenType;
  sessionId: string | null;
  status: string;
  heartbeatIntervalMs: number;
}
