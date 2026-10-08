"use client";

import { KeyRound, MonitorSmartphone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useSessions, useUserTokens } from "@/lib/queries";
import type { TokenStatus } from "@/lib/types";
import { shortHwid, timeAgo, useNow } from "@/lib/utils";
import { PageHeader } from "./app-shell";
import { Card, EmptyState, ErrorText, Skeleton, StatusBadge } from "./ui";

function Stat({ label, value, sub, loading }: { label: string; value: ReactNode; sub?: ReactNode; loading: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
      {loading ? <Skeleton className="mt-3 h-8 w-16" /> : <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>}
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

const STATUS_ORDER: TokenStatus[] = ["ACTIVE", "PAUSED", "EXPIRED", "REVOKED"];

export function OverviewView() {
  const tokens = useUserTokens();
  const sessions = useSessions();
  const now = useNow();
  const loading = tokens.isPending || sessions.isPending;

  const allSessions = sessions.data ?? [];
  const online = allSessions.filter((s) => s.status === "ONLINE");
  const inactive = allSessions.length - online.length;
  const blocked = allSessions.filter((s) => s.status === "BLOCKED").length;

  const byStatus = new Map<TokenStatus, number>();
  for (const t of tokens.data ?? []) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
  const boundDevices = (tokens.data ?? []).reduce((sum, t) => sum + t.devices.length, 0);

  return (
    <>
      <PageHeader title="Overview" description="Live state of your tokens and connected devices." />
      <ErrorText error={tokens.error ?? sessions.error} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active users" value={online.length} sub="Online right now" loading={loading} />
        <Stat label="Inactive" value={inactive} sub={blocked ? `${blocked} blocked` : "Offline or blocked"} loading={loading} />
        <Stat label="Bound devices" value={boundDevices} sub="Unique HWID bindings" loading={loading} />
        <Stat
          label="Active tokens"
          value={byStatus.get("ACTIVE") ?? 0}
          sub={`${tokens.data?.length ?? 0} total`}
          loading={loading}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          title="Connected devices"
          description="Devices currently sending heartbeats."
          className="lg:col-span-2"
          actions={
            <Link href="/sessions" className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
              Manage sessions →
            </Link>
          }
        >
          {loading ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-6" />
              <Skeleton className="h-6" />
            </div>
          ) : online.length === 0 ? (
            <EmptyState icon={<MonitorSmartphone className="size-8" />} title="No devices online">
              Devices appear here as soon as the desktop app connects.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {online.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-mono text-xs">{s.token}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {s.ipAddress ?? "unknown IP"} · HWID {shortHwid(s.hwid)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500 tabular-nums">♥ {timeAgo(s.lastHeartbeat, now)}</span>
                    <StatusBadge status={s.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Token status"
          actions={
            <Link href="/tokens" className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
              Manage →
            </Link>
          }
        >
          {(tokens.data?.length ?? 0) === 0 && !loading ? (
            <EmptyState icon={<KeyRound className="size-8" />} title="No user tokens yet" />
          ) : (
            <ul className="space-y-3 p-5">
              {STATUS_ORDER.map((status) => (
                <li key={status} className="flex items-center justify-between text-sm">
                  <StatusBadge status={status} />
                  <span className="font-medium tabular-nums">{byStatus.get(status) ?? 0}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
