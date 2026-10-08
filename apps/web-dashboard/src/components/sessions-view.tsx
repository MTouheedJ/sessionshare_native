"use client";

import { Ban, MonitorSmartphone, Power, Unlock } from "lucide-react";
import { useState } from "react";
import { useSessions, useTerminateSession, useUnblockSession } from "@/lib/queries";
import type { Session, SessionStatus } from "@/lib/types";
import { cn, formatDate, shortHwid, timeAgo, useNow } from "@/lib/utils";
import { PageHeader } from "./app-shell";
import { Button, Card, ConfirmButton, EmptyState, ErrorText, Skeleton, StatusBadge } from "./ui";

type Filter = "ALL" | SessionStatus;
const FILTERS: Filter[] = ["ONLINE", "ALL", "OFFLINE", "BLOCKED"];

function SessionActions({ session }: { session: Session }) {
  const terminate = useTerminateSession();
  const unblock = useUnblockSession();
  const busy = terminate.isPending || unblock.isPending;

  if (session.status === "BLOCKED") {
    return (
      <Button size="sm" icon={<Unlock className="size-3.5" aria-hidden />} loading={unblock.isPending}
        onClick={() => unblock.mutate(session.id)}>
        Unblock
      </Button>
    );
  }
  return (
    <div className="flex justify-end gap-1">
      {session.status === "ONLINE" && (
        <Button size="sm" variant="danger" icon={<Power className="size-3.5" aria-hidden />} disabled={busy}
          loading={terminate.isPending && terminate.variables?.block !== true}
          onClick={() => terminate.mutate({ id: session.id, block: false })}>
          Kick
        </Button>
      )}
      <ConfirmButton size="sm" icon={<Ban className="size-3.5" aria-hidden />} disabled={busy} confirmLabel="Block device?"
        title="Terminate and prevent this device from reconnecting"
        onConfirm={() => terminate.mutate({ id: session.id, block: true })}>
        Block
      </ConfirmButton>
    </div>
  );
}

export function SessionsView() {
  const sessions = useSessions();
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("ONLINE");

  const all = sessions.data ?? [];
  const rows = filter === "ALL" ? all : all.filter((s) => s.status === filter);
  const count = (f: Filter) => (f === "ALL" ? all.length : all.filter((s) => s.status === f).length);

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Every device bound to your tokens. Kick ends the session now; Block also stops it from reconnecting."
      />
      <Card
        actions={
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800" role="tablist" aria-label="Filter sessions">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === f ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400",
                )}
              >
                {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}{" "}
                <span className="tabular-nums text-zinc-400">{count(f)}</span>
              </button>
            ))}
          </div>
        }
        title="Devices"
      >
        {sessions.isPending ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : sessions.error ? (
          <div className="p-5">
            <ErrorText error={sessions.error} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<MonitorSmartphone className="size-8" />} title={filter === "ONLINE" ? "No devices online" : "No sessions"}>
            Sessions appear when a user redeems a token in the desktop app.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Token</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Device (HWID)</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">IP address</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Last heartbeat</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Connected</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {rows.map((s) => (
                  <tr key={s.id} className="align-middle">
                    <td className="px-5 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-xs">{s.token}</code>
                        {s.tokenStatus !== "ACTIVE" && <StatusBadge status={s.tokenStatus} />}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs" title={s.hwid}>{shortHwid(s.hwid)}</td>
                    <td className="px-3 py-3 font-mono text-xs">{s.ipAddress ?? "—"}</td>
                    <td className="px-3 py-3 text-xs tabular-nums">{timeAgo(s.lastHeartbeat, now)}</td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{formatDate(s.connectedAt)}</td>
                    <td className="px-5 py-3"><SessionActions session={s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
