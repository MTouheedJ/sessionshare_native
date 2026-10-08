import { Activity, AppWindow, LogOut, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import type { SandboxInfo } from "../lib/types";
import { PauseOverlay } from "./PauseOverlay";

export type LinkState = "live" | "reconnecting";

interface Props {
  sandbox: SandboxInfo;
  executable: string;
  paused: boolean;
  linkState: LinkState;
  captureProtected: boolean;
  onSignOut: () => void;
}

/**
 * The controlled frame shown while a user session is active. The confidential
 * target app runs in an isolated sandbox (separate native process); this frame
 * is the control surface that enforces pause/terminate and shows live status.
 */
export function UserSessionFrame({
  sandbox,
  executable,
  paused,
  linkState,
  captureProtected,
  onSignOut,
}: Props) {
  const appName = executable.split(/[\\/]/).pop() || executable;

  return (
    <div className="frame">
      <header className="frame__bar">
        <div className="frame__title">
          <AppWindow size={16} />
          <span>{appName}</span>
          <span className="badge badge--sandbox">Sandboxed</span>
        </div>
        <div className="frame__status">
          {captureProtected && (
            <span className="pill pill--ok" title="Screen capture is blocked for this frame">
              <ShieldCheck size={13} /> Capture-protected
            </span>
          )}
          <span className={`pill ${linkState === "live" ? "pill--ok" : "pill--warn"}`}>
            {linkState === "live" ? <Wifi size={13} /> : <WifiOff size={13} />}
            {linkState === "live" ? "Live" : "Reconnecting…"}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={onSignOut}>
            <LogOut size={14} /> End session
          </button>
        </div>
      </header>

      <div className="frame__stage">
        <div className="frame__info">
          <span className="frame__info-icon">
            <Activity size={28} />
          </span>
          <h2>Session active</h2>
          <p>
            The confidential application is running in an isolated sandbox. All activity stays on
            this device and is wiped when the session ends.
          </p>
          <dl className="kv">
            <div>
              <dt>Process</dt>
              <dd>{sandbox.pid ? `PID ${sandbox.pid}` : "—"}</dd>
            </div>
            <div>
              <dt>Seed files</dt>
              <dd>{sandbox.files_written}</dd>
            </div>
            <div>
              <dt>Sandbox</dt>
              <dd className="mono ellipsis" title={sandbox.dir}>
                {sandbox.dir}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {paused && <PauseOverlay />}
    </div>
  );
}
