import { invoke } from "@tauri-apps/api/core";
import type { SandboxInfo, VaultFile } from "./types";

let cachedHwid: string | null = null;

/** Deterministic hardware ID for this machine (SHA-256 hex). Cached per run. */
export async function getHwid(): Promise<string> {
  if (cachedHwid === null) {
    cachedHwid = await invoke<string>("get_hwid");
  }
  return cachedHwid;
}

export interface StartSandboxArgs {
  tokenId: string;
  executable: string;
  args: string[];
  files: VaultFile[];
  captureProtection: boolean;
}

/** Seeds the isolated sandbox and launches the target app bound to it. */
export function startSandbox(args: StartSandboxArgs): Promise<SandboxInfo> {
  return invoke<SandboxInfo>("start_sandbox", {
    args: {
      token_id: args.tokenId,
      executable: args.executable,
      args: args.args,
      files: args.files,
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
