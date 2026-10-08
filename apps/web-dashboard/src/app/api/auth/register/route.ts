import type { NextRequest } from "next/server";
import { forwardAuth } from "@/lib/server/auth-route";

export function POST(request: NextRequest) {
  return forwardAuth(request, "auth/register");
}
