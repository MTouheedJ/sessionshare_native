import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { SandboxInfo, VaultFile } from "./types";

export interface FileBlob {
  name: string;
  /** base64 */
  data: string;
  size: number;
}

export interface FileStat {
  path: string;
  name: string;
  size: number;
}

export interface ArtifactMeta {
  /** base64 AES-256 key */
  key: string;
  /** base64 nonce */
  nonce: string;
  /** hex SHA-256 of plaintext */
  sha256: string;
  size: number;
}

/** Returns names + sizes without reading file contents (cheap; for inline-vs-object decision). */
export function statFiles(paths: string[]): Promise<FileStat[]> {
  return invoke<FileStat[]>("stat_files", { paths });
}

/** Encrypts a file locally and uploads the ciphertext to a signed storage URL. */
export function uploadArtifact(filePath: string, uploadUrl: string): Promise<ArtifactMeta> {
  return invoke<ArtifactMeta>("upload_artifact", { filePath, uploadUrl });
}

/** Opens a native file picker for the owner to select app binaries to bundle. */
export async function pickFiles(): Promise<string[]> {
  const selection = await open({
    multiple: true,
    directory: false,
    title: "Select the application files to bundle",
  });
  if (selection === null) return [];
  return Array.isArray(selection) ? selection : [selection];
}

/** Reads the selected files on the owner's machine and base64-encodes them. */
export function readFilesB64(paths: string[]): Promise<FileBlob[]> {
  return invoke<FileBlob[]>("read_files_b64", { paths });
}

let cachedHwid: string | null = null;

/** Deterministic hardware ID for this machine (SHA-256 hex). Cached per run. */
export async function getHwid(): Promise<string> {
  if (cachedHwid === null) {
    cachedHwid = await invoke<string>("get_hwid");
  }
  return cachedHwid;
}

export interface ObjectFile {
  path: string;
  downloadUrl: string;
  key: string;
  nonce: string;
  sha256: string;
}

export interface StartSandboxArgs {
  tokenId: string;
  executable: string;
  args: string[];
  files: VaultFile[];
  objectFiles: ObjectFile[];
  captureProtection: boolean;
}

/** Seeds the isolated sandbox (inline + object artifacts) and launches the target app. */
export function startSandbox(args: StartSandboxArgs): Promise<SandboxInfo> {
  return invoke<SandboxInfo>("start_sandbox", {
    args: {
      token_id: args.tokenId,
      executable: args.executable,
      args: args.args,
      files: args.files,
      object_files: args.objectFiles.map((o) => ({
        path: o.path,
        download_url: o.downloadUrl,
        key: o.key,
        nonce: o.nonce,
        sha256: o.sha256,
      })),
      capture_protection: args.captureProtection,
    },
  });
}

/** Kills the target process and shreds the sandbox; frame returns to login. */
export function cleanupSandbox(): Promise<void> {
  return invoke("cleanup_sandbox");
}

export function setCaptureProtection(enabled: boolean): Promise<void> {
  return invoke("set_capture_protection", { enabled });
}

/** Authorised quit: tears down any session and closes the window. */
export function quitApp(): Promise<void> {
  return invoke("quit_app");
}
