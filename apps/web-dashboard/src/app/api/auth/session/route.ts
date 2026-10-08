import { NextResponse, type NextRequest } from "next/server";
import { readJwtClaims, SESSION_COOKIE } from "@/lib/server/session";

/** Returns the signed-in owner's display info (decoded from the httpOnly cookie). */
export function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? readJwtClaims(token) : null;
  if (!claims?.sub || !claims.exp || claims.exp * 1000 <= Date.now()) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ id: claims.sub, email: claims.email ?? "", expiresAt: claims.exp * 1000 });
}
