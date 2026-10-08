import { NextResponse, type NextRequest } from "next/server";
import { backendUrl, clearSessionCookie, CSRF_HEADER, SESSION_COOKIE } from "@/lib/server/session";

/** Only these API areas are reachable through the dashboard proxy. */
const ALLOWED_PREFIXES = ["tokens", "owner/tokens", "sessions", "auth/ws-ticket"] as const;
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

async function proxy(request: NextRequest, ctx: RouteContext<"/api/backend/[...path]">): Promise<NextResponse> {
  const { path } = await ctx.params;
  if (!path.every((segment) => SAFE_SEGMENT.test(segment))) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }
  const joined = path.join("/");
  if (!ALLOWED_PREFIXES.some((prefix) => joined === prefix || joined.startsWith(`${prefix}/`))) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }
  if (request.method !== "GET" && request.headers.get(CSRF_HEADER) !== "1") {
    return NextResponse.json({ message: "Missing CSRF header" }, { status: 403 });
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const hasBody = request.method !== "GET" && request.method !== "DELETE";
  let upstream: Response;
  try {
    upstream = await fetch(backendUrl(joined), {
      method: request.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(hasBody && { "Content-Type": "application/json" }),
      },
      body: hasBody ? (await request.text()) || "{}" : undefined,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ message: "API unavailable" }, { status: 502 });
  }

  const response =
    upstream.status === 204
      ? new NextResponse(null, { status: 204 })
      : new NextResponse(await upstream.text(), {
          status: upstream.status,
          headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
        });
  response.headers.set("Cache-Control", "no-store");
  if (upstream.status === 401) clearSessionCookie(response);
  return response;
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
