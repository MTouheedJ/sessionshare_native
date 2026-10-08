import { API_BASE_URL } from "./config";
import type { ValidateTokenResponse, VaultFetchResponse, VaultPayload } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body) {
    const { message } = body as { message: unknown };
    if (Array.isArray(message)) return message.join(", ");
    if (typeof message === "string") return message;
  }
  return fallback;
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...rest.headers,
      },
    });
  } catch {
    throw new ApiError("Cannot reach the SessionShare server. Check your connection.", 0);
  }

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(messageFrom(body, `Request failed (${response.status})`), response.status);
  }
  return body as T;
}

/** Validates an owner or user token, binding it to this device's HWID. */
export function validateToken(
  token: string,
  hwid: string,
  clientVersion: string,
): Promise<ValidateTokenResponse> {
  return call<ValidateTokenResponse>("/tokens/validate", {
    method: "POST",
    body: JSON.stringify({ token, hwid, clientVersion }),
  });
}

/** Fetches the decrypted owner session profile using the desktop JWT. */
export function fetchVault(accessToken: string): Promise<VaultFetchResponse> {
  return call<VaultFetchResponse>("/owner/vault/fetch", { token: accessToken });
}

/** Owner-only: uploads an encrypted session profile. */
export function uploadVault(
  accessToken: string,
  payload: VaultPayload,
): Promise<{ checksum: string; updatedAt: string; sizeBytes: number }> {
  return call("/owner/vault/upload", {
    method: "POST",
    token: accessToken,
    body: JSON.stringify({ payload }),
  });
}
