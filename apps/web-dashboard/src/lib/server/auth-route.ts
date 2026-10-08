import { NextResponse, type NextRequest } from "next/server";
import { backendUrl, CSRF_HEADER, setSessionCookie } from "./session";

interface BackendAuthResponse {
  accessToken: string;
  owner: { id: string; email: string; fullName: string | null };
}

/** Forwards login/register to the API and moves the JWT into an httpOnly cookie. */
export async function forwardAuth(request: NextRequest, path: "auth/login" | "auth/register"): Promise<NextResponse> {
  if (request.headers.get(CSRF_HEADER) !== "1") {
    return NextResponse.json({ message: "Missing CSRF header" }, { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(backendUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ message: "Authentication service unavailable" }, { status: 502 });
  }

  const body: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return NextResponse.json(body ?? { message: "Request failed" }, { status: upstream.status });
  }

  const { accessToken, owner } = body as BackendAuthResponse;
  const response = NextResponse.json({ owner }, { status: upstream.status });
  setSessionCookie(response, accessToken);
  return response;
}
