"use client";

import { Activity, KeyRound, LayoutDashboard, LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { request } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { RealtimeProvider, useRealtimeStatus } from "@/lib/realtime";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/tokens", label: "Tokens", icon: KeyRound },
  { href: "/sessions", label: "Sessions", icon: MonitorSmartphone },
] as const;

function LiveIndicator() {
  const status = useRealtimeStatus();
  const label = { live: "Live", connecting: "Connecting…", offline: "Reconnecting…" }[status];
  return (
    <span className="inline-flex items-center gap-2 text-xs text-zinc-500" role="status">
      <span
        className={cn(
          "size-2 rounded-full",
          status === "live" ? "animate-pulse bg-emerald-500" : status === "connecting" ? "bg-zinc-400" : "bg-amber-500",
        )}
        aria-hidden
      />
      <Activity className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

async function logout(): Promise<void> {
  await request("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  // Full reload: drops all cached query data from the previous session.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/login");
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const me = useMe();

  return (
    <RealtimeProvider>
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-zinc-200 bg-white md:w-60 md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2.5 px-5 py-4">
            <span className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <ShieldCheck className="size-4.5" aria-hidden />
            </span>
            <span className="font-semibold tracking-tight">SessionShare</span>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0" aria-label="Main">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                    active
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto hidden border-t border-zinc-200 p-4 md:block dark:border-zinc-800">
            <p className="truncate text-xs text-zinc-500" title={me.data?.email}>
              {me.data?.email ?? " "}
            </p>
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <LogOut className="size-3.5" aria-hidden /> Sign out
            </button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-end gap-4 border-b border-zinc-200 bg-white/70 px-6 py-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70">
            <LiveIndicator />
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 md:hidden dark:text-zinc-400"
            >
              <LogOut className="size-3.5" aria-hidden /> Sign out
            </button>
          </div>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        </div>
      </div>
    </RealtimeProvider>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
