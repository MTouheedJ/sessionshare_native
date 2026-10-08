export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const CSRF_HEADER = "x-sessionshare-csrf";

function messageFrom(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "message" in body) {
    const { message } = body as { message: unknown };
    if (Array.isArray(message)) return message.join(", ");
    if (typeof message === "string") return message;
  }
  return fallback;
}

/** Calls a same-origin route handler. The session cookie is attached by the browser. */
export async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(method !== "GET" && { [CSRF_HEADER]: "1" }),
      ...(init.body !== undefined && { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);

  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    // Session expired: full reload so the proxy re-evaluates the (cleared) cookie.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
  if (!response.ok) {
    throw new ApiError(messageFrom(body, `Request failed (${response.status})`), response.status);
  }
  return body as T;
}

/** Shorthand for the authenticated NestJS API behind the BFF proxy. */
export const api = <T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> =>
  request<T>(`/api/backend/${path.replace(/^\//, "")}`, init);
