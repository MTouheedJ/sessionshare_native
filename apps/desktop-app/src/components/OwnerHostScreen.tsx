import {
  CloudUpload,
  FilePlus2,
  FolderPlus,
  Loader2,
  LogOut,
  MonitorUp,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { presignArtifactUpload, uploadVault } from "../lib/api";
import { pickFiles, pickFolder, readFilesB64, statFiles, uploadArtifact, zipFolder } from "../lib/native";
import type { VaultFile, VaultObjectArtifact, VaultPayload } from "../lib/types";

interface Props {
  accessToken: string;
  onSignOut: () => void;
}

interface PickedFile {
  path: string;
  name: string;
}

interface FolderBundle {
  dir: string;
  zipPath: string;
  size: number;
  entries: string[];
}

/**
 * The owner's selection is either a flat set of files (single-file apps or a few
 * siblings) or a whole folder zipped into one archive (multi-file apps with
 * subfolders). Both produce a zero-install bundle the user extracts and runs.
 */
type Selection =
  | { kind: "files"; files: PickedFile[] }
  | { kind: "folder"; bundle: FolderBundle };

// Files at/under this size are inlined in the vault; larger go to object storage.
// Mirrors the backend default VAULT_INLINE_MAX_BYTES. Folder bundles always go to storage.
const INLINE_MAX_BYTES = 5 * 1024 * 1024;
// The sandbox-relative directory a folder bundle is extracted into.
const ARCHIVE_DIR = "app";

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 1 : 0)} MB`;
}

/** Picks a sensible default main executable from flat files. */
function defaultMainName(files: PickedFile[]): string {
  return (files.find((f) => f.name.toLowerCase().endsWith(".exe")) ?? files[0])?.name ?? "";
}

/** Picks a sensible default main executable (relative path) from a folder's entries. */
function defaultMainRel(entries: string[]): string {
  const exes = entries.filter((e) => e.toLowerCase().endsWith(".exe"));
  const pool = exes.length > 0 ? exes : entries;
  // Prefer the shallowest path, then the shortest, so a top-level foo.exe wins.
  return (
    [...pool].sort(
      (a, b) => a.split("/").length - b.split("/").length || a.length - b.length,
    )[0] ?? ""
  );
}

/**
 * Owner "Sharing Host Engine": bundle the confidential application's binaries into
 * the encrypted vault (zero-install), set the isolation policy, and publish. Users
 * redeeming a token extract and run it entirely inside their own sandbox — no
 * pre-installed copy required on their machine.
 */
export function OwnerHostScreen({ accessToken, onSignOut }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mainExe, setMainExe] = useState("");
  const [args, setArgs] = useState("");
  const [captureProtection, setCaptureProtection] = useState(true);
  const [blockClipboard, setBlockClipboard] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ checksum: string } | null>(null);

  async function chooseFiles(): Promise<void> {
    setError(null);
    try {
      const paths = await pickFiles();
      if (paths.length === 0) return;
      const existing = selection?.kind === "files" ? selection.files : [];
      // De-duplicate by file name (they all land flat in bin/).
      const merged = new Map<string, PickedFile>();
      for (const f of [...existing, ...paths.map((p) => ({ path: p, name: basename(p) }))]) {
        merged.set(f.name, f);
      }
      const next = [...merged.values()];
      setSelection({ kind: "files", files: next });
      if (!mainExe || !next.some((f) => f.name === mainExe)) setMainExe(defaultMainName(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function chooseFolder(): Promise<void> {
    setError(null);
    setBusy(true);
    setProgress("Compressing folder…");
    try {
      const dir = await pickFolder();
      if (dir === null) return;
      const result = await zipFolder(dir);
      const bundle: FolderBundle = { dir, ...result };
      setSelection({ kind: "folder", bundle });
      setMainExe(defaultMainRel(result.entries));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function removeFile(name: string): void {
    if (selection?.kind !== "files") return;
    const next = selection.files.filter((f) => f.name !== name);
    setSelection(next.length > 0 ? { kind: "files", files: next } : null);
    if (mainExe === name) setMainExe(defaultMainName(next));
  }

  async function handlePublish(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selection) {
      setError("Choose the application file(s) or folder to bundle.");
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
      const inline: VaultFile[] = [];
      const objectArtifacts: VaultObjectArtifact[] = [];
      let executable: string;

      if (selection.kind === "folder") {
        // One encrypted ZIP straight to object storage; the user unzips it into the sandbox.
        const { bundle } = selection;
        setProgress(`Uploading bundle (${mb(bundle.size)})…`);
        const signed = await presignArtifactUpload(accessToken);
        const meta = await uploadArtifact(bundle.zipPath, signed.uploadUrl);
        objectArtifacts.push({
          path: ARCHIVE_DIR,
          archive: true,
          objectKey: signed.objectKey,
          key: meta.key,
          nonce: meta.nonce,
          sha256: meta.sha256,
          size: meta.size,
        });
        executable = `${ARCHIVE_DIR}/${mainExe}`;
      } else {
        // Flat files: small ones inline, large ones to object storage.
        const stats = await statFiles(selection.files.map((f) => f.path));
        for (const file of stats) {
          if (file.size <= INLINE_MAX_BYTES) {
            setProgress(`Bundling ${file.name}…`);
            const [blob] = await readFilesB64([file.path]);
            inline.push({ path: `bin/${file.name}`, data: blob.data });
          } else {
            setProgress(`Uploading ${file.name} (${mb(file.size)})…`);
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
        executable = `bin/${mainExe}`;
      }

      setProgress("Publishing profile…");
      const payload: VaultPayload = {
        version: 1,
        app: {
          // Relative path resolved inside the user's sandbox at launch.
          executable,
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

  const folder = selection?.kind === "folder" ? selection.bundle : null;
  const files = selection?.kind === "files" ? selection.files : [];
  const exeOptions = folder
    ? (folder.entries.filter((e) => e.toLowerCase().endsWith(".exe")).length > 0
        ? folder.entries.filter((e) => e.toLowerCase().endsWith(".exe"))
        : folder.entries)
    : [];

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
          Bundle the confidential application into the encrypted vault. Users redeeming a token
          unpack and run it inside their own sandbox — nothing needs to be pre-installed on their
          machine.
        </p>

        <div className="field">
          <span className="field__label">Application</span>
          <div className="host__pick">
            <button type="button" className="btn btn--secondary" onClick={() => void chooseFiles()} disabled={busy}>
              <FilePlus2 size={15} /> Choose file(s)…
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => void chooseFolder()} disabled={busy}>
              <FolderPlus size={15} /> Choose a folder…
            </button>
          </div>
          <span className="field__hint">
            Pick <strong>file(s)</strong> for a single-file app (or a few siblings), or a whole{" "}
            <strong>folder</strong> for multi-file apps with subfolders (DLLs, <code>resources/</code>).
            A folder is zipped, encrypted, and uploaded as one bundle.
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

        {folder && (
          <div className="field">
            <div className="filelist__item">
              <span className="mono">{basename(folder.dir)}</span>
              <span className="field__hint">
                {folder.entries.length} files · {mb(folder.size)} zipped
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setSelection(null);
                  setMainExe("");
                }}
                aria-label="Remove folder"
                disabled={busy}
              >
                <X size={14} />
              </button>
            </div>
            <label className="field">
              <span className="field__label">Main executable</span>
              <select
                className="field__input mono"
                value={mainExe}
                onChange={(e) => setMainExe(e.target.value)}
                disabled={busy}
              >
                {exeOptions.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <span className="field__hint">The file launched inside the user's sandbox.</span>
            </label>
          </div>
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
