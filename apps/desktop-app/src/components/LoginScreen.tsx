import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { OWNER_TOKEN_PREFIX } from "../lib/config";

interface Props {
  onSubmit: (token: string) => void;
  busy: boolean;
  error: string | null;
  prefillToken?: string;
}

export function LoginScreen({ onSubmit, busy, error, prefillToken }: Props) {
  const [token, setToken] = useState(prefillToken ?? "");
  const trimmed = token.trim();
  const kind = trimmed.startsWith(OWNER_TOKEN_PREFIX)
    ? "owner"
    : trimmed.length > 0
      ? "user"
      : null;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (trimmed.length > 0 && !busy) onSubmit(trimmed);
  }

  return (
    <div className="login">
      <div className="login__brand">
        <span className="login__logo">
          <ShieldCheck size={26} />
        </span>
        <h1>SessionShare</h1>
        <p>Enter your access token to begin a secure session.</p>
      </div>

      <form className="login__card" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field__label">Access token</span>
          <div className="field__input-wrap">
            <KeyRound size={16} className="field__icon" aria-hidden />
            <input
              className="field__input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="SS-XXXXX-XXXXX-XXXXX-XXXXX  or  sso_…"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
            />
          </div>
          {kind && (
            <span className="field__hint">
              Detected <strong>{kind === "owner" ? "Owner master token" : "User token"}</strong>
            </span>
          )}
        </label>

        {error && (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        )}

        <button className="btn btn--primary btn--block" type="submit" disabled={busy || trimmed.length === 0}>
          {busy ? (
            <>
              <Loader2 size={16} className="spin" /> Connecting…
            </>
          ) : kind === "owner" ? (
            "Start hosting"
          ) : (
            "Launch session"
          )}
        </button>
      </form>

      <p className="login__foot">This device is bound to the token on first use.</p>
    </div>
  );
}
