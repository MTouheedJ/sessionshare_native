import { CloudUpload, FilePlus2, Loader2, LogOut, MonitorUp, ShieldCheck, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { presignArtifactUpload, uploadVault } from "../lib/api";
import { pickFiles, readFilesB64, statFiles, uploadArtifact } from "../lib/native";
import type { VaultFile, VaultObjectArtifact, VaultPayload } from "../lib/types";

interface Props {
  accessToken: string;
  onSignOut: () => void;
}

interface PickedFile {
  path: string;
  name: string;
}

// Files at/under this size are inlined in the vault; larger go to object storage.
// Mirrors the backend default VAULT_INLINE_MAX_BYTES.
const INLINE_MAX_BYTES = 5 * 1024 * 1024;

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Picks a sensible default main executable from the selected files. */
function defaultMain(files: PickedFile[]): string {
  return (files.find((f) => f.name.toLowerCase().endsWith(".exe")) ?? files[0])?.name ?? "";
}

/**
 * Owner "Sharing Host Engine": bundle the confidential application's binaries into
 * the encrypted vault (zero-install), set the isolation policy, and publish. Users
 * redeeming a token extract and run it entirely inside their own sandbox — no
 * pre-installed copy required on their machine.
 */
export function OwnerHostScreen({ accessToken, onSignOut }: Props) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [mainExe, setMainExe] = useState("");
  const [args, setArgs] = useState("");
  const [captureProtection, setCaptureProtection] = useState(true);
  const [blockClipboard, setBlockClipboard] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ checksum: string } | null>(null);

  async function choose(): Promise<void> {
    setError(null);
    try {
      const paths = await pickFiles();
      if (paths.length === 0) return;
      // De-duplicate by file name (they all land flat in bin/).
      const merged = new Map<string, PickedFile>();
      for (const f of [...files, ...paths.map((p) => ({ path: p, name: basename(p) }))]) {
        merged.set(f.name, f);
      }
      const next = [...merged.values()];
      setFiles(next);
      if (!mainExe || !next.some((f) => f.name === mainExe)) setMainExe(defaultMain(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function removeFile(name: string): void {
    const next = files.filter((f) => f.name !== name);
    setFiles(next);
    if (mainExe === name) setMainExe(defaultMain(next));
  }

  async function handlePublish(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (files.length === 0) {
      setError("Choose the application file(s) to bundle.");
      return;
    }
    if (!mainExe) {
      setError("Select which file is the main executable.");
      return;
    }
    setBusy(true);
    setError(null);
    setPublished(null);
    try {
      const stats = await statFiles(files.map((f) => f.path));
      const inline: VaultFile[] = [];
      const objectArtifacts: VaultObjectArtifact[] = [];

      for (const file of stats) {
        if (file.size <= INLINE_MAX_BYTES) {
          setProgress(`Bundling ${file.name}…`);
          const [blob] = await readFilesB64([file.path]);
          inline.push({ path: `bin/${file.name}`, data: blob.data });
        } else {
          // Large: encrypt locally and upload straight to object storage.
          setProgress(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(0)} MB)…`);
          const signed = await presignArtifactUpload(accessToken);
          const meta = await uploadArtifact(file.path, signed.uploadUrl);
          objectArtifacts.push({
            path: `bin/${file.name}`,
            objectKey: signed.objectKey,
            key: meta.key,
            nonce: meta.nonce,
            sha256: meta.sha256,
            size: meta.size,
          });
        }
      }

      setProgress("Publishing profile…");
      const payload: VaultPayload = {
        version: 1,
        app: {
          // Relative path resolved inside the user's sandbox at launch.
          executable: `bin/${mainExe}`,
          args: args
            .split("\n")
            .flatMap((line) => line.split(" "))
            .map((a) => a.trim())
            .filter((a) => a.length > 0),
        },
        policy: { captureProtection, blockClipboard },
        files: inline,
        objectArtifacts,
      };
      const result = await uploadVault(accessToken, payload);
      setPublished({ checksum: result.checksum });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      setProgress(null);
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
          Bundle the confidential application's files into the encrypted vault. Users redeeming a
          token unpack and run it inside their own sandbox — nothing needs to be pre-installed on
          their machine.
        </p>

        <div className="field">
          <span className="field__label">Application files</span>
          <button type="button" className="btn btn--secondary" onClick={() => void choose()} disabled={busy}>
            <FilePlus2 size={15} /> {files.length === 0 ? "Choose files to bundle…" : "Add more files…"}
          </button>
          <span className="field__hint">
            Select the app's <code>.exe</code> and any files it needs beside it (DLLs, assets). They
            are stored together in <code>bin/</code> inside the sandbox.
          </span>
        </div>

        {files.length > 0 && (
          <ul className="filelist">
            {files.map((f) => (
              <li key={f.name} className="filelist__item">
                <label className="filelist__main">
                  <input
                    type="radio"
                    name="mainExe"
                    checked={mainExe === f.name}
                    onChange={() => setMainExe(f.name)}
                    disabled={busy}
                  />
                  <span className="mono">{f.name}</span>
                  {mainExe === f.name && <span className="badge badge--sandbox">main</span>}
                </label>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => removeFile(f.name)}
                  aria-label={`Remove ${f.name}`}
                  disabled={busy}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="field">
          <span className="field__label">Launch arguments</span>
          <textarea
            className="field__input field__input--area mono"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            rows={2}
            spellCheck={false}
            placeholder="e.g. --user-data-dir={sandbox}"
            disabled={busy}
          />
          <span className="field__hint">
            <code>{"{sandbox}"}</code> is replaced with each user's isolated data directory. Leave
            empty for apps that take no arguments.
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
          {busy ? (progress ?? "Bundling & publishing…") : "Encrypt & publish to vault"}
        </button>
      </form>
    </div>
  );
}
