import { clsx, type ClassValue } from "clsx";
import { useEffect, useState } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Custom URL scheme the desktop app registers to receive a token (Step 3). */
export const DESKTOP_LINK_SCHEME = "sessionshare";

export function desktopLink(token: string): string {
  return `${DESKTOP_LINK_SCHEME}://redeem?token=${encodeURIComponent(token)}`;
}

export function shortHwid(hwid: string): string {
  return `${hwid.slice(0, 8)}…${hwid.slice(-4)}`;
}

export function timeAgo(iso: string | null, now: number): string {
  if (!iso || now === 0) return "—";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Re-renders every `intervalMs` so relative timestamps stay current.
 * Starts at 0 (rendered as "—") because the clock must not be read during prerender.
 */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = (): void => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}
