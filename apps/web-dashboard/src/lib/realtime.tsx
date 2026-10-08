"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { io } from "socket.io-client";
import { api } from "./api";
import { queryKeys } from "./queries";
import type { DashboardEvent, Session, UserToken } from "./types";

export type RealtimeStatus = "connecting" | "live" | "offline";

const RealtimeContext = createContext<RealtimeStatus>("connecting");

function applyHeartbeat(client: QueryClient, event: Extract<DashboardEvent, { type: "session.heartbeat" }>): void {
  client.setQueryData<Session[]>(queryKeys.sessions, (sessions) =>
    sessions?.map((s) =>
      s.id === event.sessionId
        ? { ...s, status: "ONLINE", lastHeartbeat: event.lastHeartbeat, ipAddress: event.ipAddress }
        : s,
    ),
  );
  client.setQueryData<UserToken[]>(queryKeys.userTokens, (tokens) =>
    tokens?.map((t) =>
      t.id === event.tokenId
        ? {
            ...t,
            devices: t.devices.map((d) =>
              d.sessionId === event.sessionId
                ? { ...d, status: "ONLINE", lastHeartbeat: event.lastHeartbeat, ipAddress: event.ipAddress }
                : d,
            ),
          }
        : t,
    ),
  );
}

function handleEvent(client: QueryClient, event: DashboardEvent): void {
  switch (event.type) {
    case "session.heartbeat":
      applyHeartbeat(client, event);
      return;
    case "session.updated":
      void client.invalidateQueries({ queryKey: queryKeys.sessions });
      void client.invalidateQueries({ queryKey: queryKeys.userTokens });
      return;
    case "token.updated":
    case "token.deleted":
      if (event.tokenType === "OWNER") {
        void client.invalidateQueries({ queryKey: queryKeys.ownerTokens });
      } else {
        void client.invalidateQueries({ queryKey: queryKeys.userTokens });
        void client.invalidateQueries({ queryKey: queryKeys.sessions });
      }
  }
}

/** Live feed from `/ws/dashboard`. Each (re)connect fetches a fresh short-lived ticket. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:3000";
    const socket = io(`${url}/ws/dashboard`, {
      transports: ["websocket"],
      auth: (cb) => {
        api<{ ticket: string }>("auth/ws-ticket", { method: "POST" })
          .then(({ ticket }) => cb({ token: ticket }))
          .catch(() => cb({}));
      },
    });

    socket.on("connect", () => {
      setStatus("live");
      // Catch up on anything missed while disconnected.
      void client.invalidateQueries();
    });
    socket.on("disconnect", (reason) => {
      setStatus("offline");
      // Server-side rejection (e.g. bad ticket) does not auto-reconnect.
      if (reason === "io server disconnect") setTimeout(() => socket.connect(), 3_000);
    });
    socket.on("connect_error", () => setStatus("offline"));
    socket.on("dashboard:event", (event: DashboardEvent) => handleEvent(client, event));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [client]);

  return <RealtimeContext value={status}>{children}</RealtimeContext>;
}

export function useRealtimeStatus(): RealtimeStatus {
  return use(RealtimeContext);
}
