import { Lock } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * Full-screen blurred overlay shown on `pause_session`. Captures all keyboard
 * and pointer input over the control frame so interaction is disabled until resume.
 */
export function PauseOverlay() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Trap focus so keyboard input can't reach anything behind the overlay.
    ref.current?.focus();
    const swallow = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    const opts = { capture: true } as const;
    window.addEventListener("keydown", swallow, opts);
    window.addEventListener("keyup", swallow, opts);
    return () => {
      window.removeEventListener("keydown", swallow, opts);
      window.removeEventListener("keyup", swallow, opts);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="overlay"
      tabIndex={-1}
      role="alertdialog"
      aria-label="Session paused"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="overlay__card">
        <span className="overlay__icon">
          <Lock size={32} />
        </span>
        <h2>Session Paused by Owner</h2>
        <p>Your access has been temporarily suspended. Please wait — it will resume automatically.</p>
      </div>
    </div>
  );
}
