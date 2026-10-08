"use client";

import { Ban, KeyRound, Link as LinkIcon, Pause, Play, Plus, ShieldCheck, Trash2, TriangleAlert, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  useCreateOwnerToken,
  useCreateUserToken,
  useDeleteUserToken,
  useOwnerTokens,
  useRevokeOwnerToken,
  useSetTokenStatus,
  useUserTokens,
} from "@/lib/queries";
import type { OwnerTokenCreated, UserToken } from "@/lib/types";
import { desktopLink, formatDate, shortHwid, timeAgo, useNow } from "@/lib/utils";
import { PageHeader } from "./app-shell";
import { Button, Card, ConfirmButton, CopyButton, EmptyState, ErrorText, Field, Input, Skeleton, StatusBadge } from "./ui";

// ------------------------------------------------------------------ user tokens

function GenerateUserTokenForm({ onDone }: { onDone: () => void }) {
  const create = useCreateUserToken();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const maxUses = Number(form.get("maxUses"));
    const hours = String(form.get("expiresInHours") ?? "").trim();
    create.mutate(
      { maxUses, ...(hours ? { expiresInHours: Number(hours) } : {}) },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 border-b border-zinc-200 bg-zinc-50 px-5 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end dark:border-zinc-800 dark:bg-zinc-950/40">
      <Field label="Device bindings" hint="Max distinct devices (HWIDs) that can redeem it.">
        <Input name="maxUses" type="number" min={1} max={10000} defaultValue={1} required />
      </Field>
      <Field label="Expires in (hours)" hint="Leave empty for no expiry.">
        <Input name="expiresInHours" type="number" min={1} max={8760} placeholder="e.g. 24" />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={create.isPending}>
          Generate
        </Button>
        <Button variant="ghost" onClick={onDone} aria-label="Cancel">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      {create.error && (
        <div className="sm:col-span-3">
          <ErrorText error={create.error} />
        </div>
      )}
    </form>
  );
}

function UserTokenRow({ token, now }: { token: UserToken; now: number }) {
  const setStatus = useSetTokenStatus();
  const remove = useDeleteUserToken();
  const busy = setStatus.isPending || remove.isPending;
  const terminal = token.status === "REVOKED" || token.status === "EXPIRED";

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-sm dark:bg-zinc-800">{token.token}</code>
            <StatusBadge status={token.status} />
          </div>
          <p className="text-xs text-zinc-500">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {token.remainingUses} of {token.maxUses}
            </span>{" "}
            binding{token.maxUses === 1 ? "" : "s"} remaining · created {formatDate(token.createdAt)} ·{" "}
            {token.expiresAt ? `expires ${formatDate(token.expiresAt)}` : "no expiry"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <CopyButton value={token.token} label="Token" />
          <CopyButton value={desktopLink(token.token)} label="Link" />
          {token.status === "ACTIVE" && (
            <Button size="sm" icon={<Pause className="size-3.5" aria-hidden />} loading={setStatus.isPending} disabled={busy}
              onClick={() => setStatus.mutate({ id: token.id, status: "PAUSED" })}>
              Pause
            </Button>
          )}
          {token.status === "PAUSED" && (
            <Button size="sm" icon={<Play className="size-3.5" aria-hidden />} loading={setStatus.isPending} disabled={busy}
              onClick={() => setStatus.mutate({ id: token.id, status: "ACTIVE" })}>
              Resume
            </Button>
          )}
          {!terminal && (
            <ConfirmButton size="sm" icon={<Ban className="size-3.5" aria-hidden />} disabled={busy} confirmLabel="Revoke?"
              onConfirm={() => setStatus.mutate({ id: token.id, status: "REVOKED" })}>
              Revoke
            </ConfirmButton>
          )}
          <ConfirmButton size="sm" variant="ghost" icon={<Trash2 className="size-3.5" aria-hidden />} disabled={busy}
            confirmLabel="Delete?" aria-label="Delete token" onConfirm={() => remove.mutate(token.id)} />
        </div>
      </div>

      <div className="mt-3">
        {token.devices.length === 0 ? (
          <p className="text-xs text-zinc-500">
            <LinkIcon className="mr-1 inline size-3" aria-hidden />
            Not yet bound — the first device to redeem it will be locked to this token.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {token.devices.map((d) => (
              <li key={d.sessionId} className="flex items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs dark:border-zinc-800">
                <StatusBadge status={d.status} />
                <span className="font-mono" title={d.hwid}>
                  {shortHwid(d.hwid)}
                </span>
                <span className="text-zinc-500">{d.ipAddress ?? "—"}</span>
                <span className="text-zinc-500 tabular-nums">♥ {timeAgo(d.lastHeartbeat, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ErrorText error={setStatus.error ?? remove.error} />
    </li>
  );
}

function UserTokensCard() {
  const tokens = useUserTokens();
  const [creating, setCreating] = useState(false);
  const now = useNow();

  return (
    <Card
      title="User tokens"
      description="Hand these to users. Each binds to the hardware (HWID) of the device that redeems it."
      actions={
        !creating && (
          <Button variant="primary" size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => setCreating(true)}>
            Generate token
          </Button>
        )
      }
    >
      {creating && <GenerateUserTokenForm onDone={() => setCreating(false)} />}
      {tokens.isPending ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : tokens.error ? (
        <div className="p-5">
          <ErrorText error={tokens.error} />
        </div>
      ) : tokens.data.length === 0 ? (
        <EmptyState icon={<KeyRound className="size-8" />} title="No user tokens yet">
          Generate one to give a user access.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {tokens.data.map((t) => (
            <UserTokenRow key={t.id} token={t} now={now} />
          ))}
        </ul>
      )}
    </Card>
  );
}

// ----------------------------------------------------------------- owner tokens

function RevealedOwnerToken({ created, onDismiss }: { created: OwnerTokenCreated; onDismiss: () => void }) {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-500/20 dark:bg-amber-500/10">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-300">
        <TriangleAlert className="size-4" aria-hidden />
        Copy “{created.name}” now — it will not be shown again.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded bg-white px-3 py-2 font-mono text-xs break-all ring-1 ring-amber-200 dark:bg-zinc-900 dark:ring-amber-500/30">
          {created.token}
        </code>
        <CopyButton value={created.token} />
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}

function OwnerTokensCard() {
  const tokens = useOwnerTokens();
  const create = useCreateOwnerToken();
  const revoke = useRevokeOwnerToken();
  const [revealed, setRevealed] = useState<OwnerTokenCreated | null>(null);
  const [name, setName] = useState("");

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate(name.trim() || undefined, {
      onSuccess: (created) => {
        setRevealed(created);
        setName("");
      },
    });
  }

  return (
    <Card title="Owner master tokens" description="Used by your own desktop app to capture and sync the session vault.">
      {revealed && <RevealedOwnerToken created={revealed} onDismiss={() => setRevealed(null)} />}
      <form onSubmit={onCreate} className="flex flex-wrap gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <Input
          aria-label="Token name"
          placeholder="Name (e.g. Office workstation)"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs flex-1"
        />
        <Button type="submit" size="md" icon={<Plus className="size-3.5" aria-hidden />} loading={create.isPending}>
          Create
        </Button>
      </form>
      <ErrorText error={create.error ?? revoke.error} />
      {tokens.isPending ? (
        <div className="p-5">
          <Skeleton className="h-8" />
        </div>
      ) : tokens.error ? (
        <div className="p-5">
          <ErrorText error={tokens.error} />
        </div>
      ) : tokens.data.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-8" />} title="No owner tokens" />
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {tokens.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.name}</span>
                  <StatusBadge status={t.isActive ? "ACTIVE" : "REVOKED"} />
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Created {formatDate(t.createdAt)} · last used {formatDate(t.lastUsedAt)}
                </p>
              </div>
              {t.isActive && (
                <ConfirmButton size="sm" icon={<Ban className="size-3.5" aria-hidden />} confirmLabel="Revoke?"
                  disabled={revoke.isPending} onConfirm={() => revoke.mutate(t.id)}>
                  Revoke
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function TokensView() {
  return (
    <>
      <PageHeader title="Tokens" description="Generate, pause, resume and revoke access. Changes reach connected devices instantly." />
      <div className="space-y-6">
        <UserTokensCard />
        <OwnerTokensCard />
      </div>
    </>
  );
}
