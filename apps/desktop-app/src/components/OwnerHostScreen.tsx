import { CloudUpload, Loader2, LogOut, MonitorUp, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { uploadVault } from "../lib/api";
import type { VaultPayload } from "../lib/types";

interface Props {
  accessToken: string;
  onSignOut: () => void;
}

/**
 * Owner "Sharing Host Engine": point at the confidential target application,
 * set isolation policy, and publish the encrypted session profile to the vault.
 * User clients then fetch it and launch the app in their own sandbox.
 */
export function OwnerHostScreen({ accessToken, onSignOut }: Props) {
  const [executable, setExecutable] = useState("");
  const [args, setArgs] = useState("--user-data-dir={sandbox}");
  const [captureProtection, setCaptureProtection] = useState(true);
  const [blockClipboard, setBlockClipboard] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ checksum: string; at: string } | null>(null);

  async function handlePublish(event: FormEvent): Promise<void> {
    event.preventDefault();
    const exe = executable.trim();
    if (exe.length < 3) {
      setError("Enter the full path to the target application.");
      return;
    }
    setBusy(true);
    setError(null);
    setPublished(null);
    const payload: VaultPayload = {
      version: 1,
      app: {
        executable: exe,
        args: args
          .split("\n")
          .flatMap((line) => line.split(" "))
          .map((a) => a.trim())
          .filter((a) => a.length > 0),
      },
      policy: { captureProtection, blockClipboard },
      files: [],
    };
    try {
      const result = await uploadVault(accessToken, payload);
      setPublished({ checksum: result.checksum, at: result.updatedAt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="host">
      <header className="host__bar">
        <div className="frame__title">
          <MonitorUp size={16} /> <span>Owner Host Engine</span>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={onSignOut}>
          <LogOut size={14} /> Sign out
        </button>
      </header>

      <form className="host__card" onSubmit={handlePublish}>
        <h2>Publish session profile</h2>
        <p className="host__lead">
          Define the confidential application and isolation policy. The profile is encrypted and
          stored in the vault; users redeeming a token launch it inside their own sandbox.
        </p>

        <label className="field">
          <span className="field__label">Target application path</span>
          <input
            className="field__input field__input--plain mono"
            value={executable}
            onChange={(e) => setExecutable(e.target.value)}
            placeholder="C:\\Program Files\\ConfidentialApp\\app.exe"
            spellCheck={false}
            disabled={busy}
          />
        </label>

        <label className="field">
          <span className="field__label">Launch arguments</span>
          <textarea
            className="field__input field__input--area mono"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            rows={2}
            spellCheck={false}
            disabled={busy}
          />
          <span className="field__hint">
            <code>{"{sandbox}"}</code> is replaced with each user's isolated data directory.
          </span>
        </label>

        <div className="host__policies">
          <label className="check">
            <input
              type="checkbox"
              checked={captureProtection}
              onChange={(e) => setCaptureProtection(e.target.checked)}
              disabled={busy}
            />
            <span>
              <ShieldCheck size={14} /> Block screen capture on user frames
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={blockClipboard}
              onChange={(e) => setBlockClipboard(e.target.checked)}
              disabled={busy}
            />
            <span>Disable clipboard copy out of the sandbox</span>
          </label>
        </div>

        {error && (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        )}
        {published && (
          <p className="alert alert--ok" role="status">
            Published. Checksum <code>{published.checksum.slice(0, 16)}…</code>
          </p>
        )}

        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <CloudUpload size={16} />}
          {busy ? "Publishing…" : "Encrypt & publish to vault"}
        </button>
      </form>
    </div>
  );
}
