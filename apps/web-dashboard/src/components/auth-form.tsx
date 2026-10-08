"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { request } from "@/lib/api";
import { Button, ErrorText, Field, Input } from "./ui";

type Mode = "login" | "register";

const COPY: Record<Mode, { title: string; submit: string; alt: string; altHref: string; altLabel: string }> = {
  login: { title: "Sign in to your console", submit: "Sign in", alt: "New owner?", altHref: "/register", altLabel: "Create an account" },
  register: { title: "Create an owner account", submit: "Create account", alt: "Already registered?", altHref: "/login", altLabel: "Sign in" },
};

/** Only allow same-origin relative redirects after login. */
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function AuthForm({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (mode === "register" && password !== String(form.get("confirm") ?? "")) {
      setError(new Error("Passwords do not match"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await request(`/api/auth/${mode}`, {
        method: "POST",
        body: {
          email: String(form.get("email") ?? ""),
          password,
          ...(mode === "register" && form.get("fullName") ? { fullName: String(form.get("fullName")) } : {}),
        },
      });
      // Full navigation so the proxy sees the new cookie.
      window.location.assign(safeNext());
    } catch (err) {
      setError(err);
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {mode === "register" && (
            <Field label="Full name">
              <Input name="fullName" autoComplete="name" maxLength={100} />
            </Field>
          )}
          <Field label="Email">
            <Input name="email" type="email" autoComplete="email" required maxLength={255} />
          </Field>
          <Field label="Password" hint={mode === "register" ? "At least 12 characters." : undefined}>
            <Input
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "register" ? 12 : 1}
              maxLength={72}
            />
          </Field>
          {mode === "register" && (
            <Field label="Confirm password">
              <Input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={72} />
            </Field>
          )}
          <ErrorText error={error} />
          <Button type="submit" variant="primary" loading={pending} className="w-full">
            {copy.submit}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-zinc-500">
          {copy.alt}{" "}
          <Link href={copy.altHref} className="font-medium text-indigo-600 hover:text-indigo-500">
            {copy.altLabel}
          </Link>
        </p>
      </div>
    </main>
  );
}
