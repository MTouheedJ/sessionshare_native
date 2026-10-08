import { NextResponse, type NextRequest } from "next/server";
import { clearSessionCookie, CSRF_HEADER } from "@/lib/server/session";

export function POST(request: NextRequest) {
  if (request.headers.get(CSRF_HEADER) !== "1") {
    return NextResponse.json({ message: "Missing CSRF header" }, { status: 403 });
  }
  const response = new NextResponse(null, { status: 204 });
  clearSessionCookie(response);
  return response;
}
