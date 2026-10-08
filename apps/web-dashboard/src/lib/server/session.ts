import type { NextResponse } from "next/server";

/** httpOnly cookie holding the owner JWT. Never readable from browser JavaScript. */
export const SESSION_COOKIE = "ss_session";
/** Header required on every mutating BFF request (CSRF defence alongside SameSite=Strict). */
export const CSRF_HEADER = "x-sessionshare-csrf";

const DEFAULT_MAX_AGE_SECONDS = 60 * 60;

export function backendUrl(path: string): string {
  const base = process.env.BACKEND_API_URL ?? "http://localhost:3000/api/v1";
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

interface JwtClaims {
  sub?: string;
  email?: string;
  exp?: number;
}

/** Decodes (without verifying) JWT claims. Only for display/expiry; the API verifies signatures. */
export function readJwtClaims(token: string): JwtClaims | null {
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const json: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json === "object" && json !== null ? (json as JwtClaims) : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(response: NextResponse, token: string): void {
  const exp = readJwtClaims(token)?.exp;
  const maxAge = exp ? Math.max(exp - Math.floor(Date.now() / 1000), 0) : DEFAULT_MAX_AGE_SECONDS;
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
