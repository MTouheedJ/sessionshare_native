import { NextResponse, type NextRequest } from "next/server";

// Kept in sync with lib/server/session.ts — proxy should not share runtime modules.
const SESSION_COOKIE = "ss_session";
const PUBLIC_PATHS = new Set(["/login", "/register"]);

/** Optimistic route gate based on cookie presence. The API still verifies every request. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (!signedIn && !isPublic) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (signedIn && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico)$).*)"],
};
