import { Loader2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { LoginScreen } from "./components/LoginScreen";
import { OwnerHostScreen } from "./components/OwnerHostScreen";
import { UserSessionFrame, type LinkState } from "./components/UserSessionFrame";
import { fetchVault, validateToken } from "./lib/api";
import { cleanupSandbox, getHwid, quitApp, startSandbox } from "./lib/native";
import { SessionSocket } from "./lib/session-socket";
import type { DesktopControlPayload, SandboxInfo, VaultApp } from "./lib/types";

type View =
  | { status: "login"; prefill?: string }
  | { status: "connecting"; message: string }
  | { status: "owner"; accessToken: string }
  | { status: "user" };

interface UserSession {
  sandbox: SandboxInfo;
  app: VaultApp;
  captureProtected: boolean;
}

/** Pulls the token out of a sessionshare://redeem?token=... deep link. */
function tokenFromDeepLink(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("token");
  } catch {
    return null;
  }
}

export default function App() {
  const [view, setView] = useState<View>({ status: "login" });
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [linkState, setLinkState] = useState<LinkState>("live");
  const [userSession, setUserSession] = useState<UserSession | null>(null);

  const socketRef = useRef<SessionSocket | null>(null);
  const versionRef = useRef<string>("0.1.0");

  useEffect(() => {
    void getVersion().then((v) => (versionRef.current = v)).catch(() => undefined);
  }, []);

  const teardown = useCallback(async (): Promise<void> => {
    socketRef.current?.close();
    socketRef.current = null;
    setPaused(false);
    setLinkState("live");
    setUserSession(null);
    await cleanupSandbox().catch(() => undefined);
  }, []);

  const returnToLogin = useCallback(
    async (message: string | null) => {
      await teardown();
      setBanner(message);
      setError(null);
      setView({ status: "login" });
    },
    [teardown],
  );

  const onTerminate = useCallback(
    (payload: DesktopControlPayload) => {
      const reason = payload.reason === "DELETED" ? "deleted" : payload.reason.toLowerCase();
      void returnToLogin(`Session terminated — your token was ${reason}.`);
    },
    [returnToLogin],
  );

  const connect = useCallback(
    (accessToken: string, tokenId: string, hwid: string, onReady: () => void) => {
      const socket = new SessionSocket(accessToken, tokenId, hwid, versionRef.current, {
        onAck: () => {
          setLinkState("live");
          onReady();
        },
        onPause: () => setPaused(true),
        onResume: () => setPaused(false),
        onTerminate,
        onError: (message) => setError(message),
        onDisconnect: () => setLinkState("reconnecting"),
      });
      socket.connect();
      socketRef.current = socket;
    },
    [onTerminate],
  );

  const handleSubmit = useCallback(
    async (token: string) => {
      setError(null);
      setBanner(null);
      setView({ status: "connecting", message: "Validating token…" });
      try {
        const hwid = await getHwid();
        const auth = await validateToken(token, hwid, versionRef.current);

        if (auth.tokenType === "OWNER") {
          connect(auth.accessToken, auth.tokenId, hwid, () => undefined);
          setView({ status: "owner", accessToken: auth.accessToken });
          return;
        }

        setView({ status: "connecting", message: "Fetching session profile…" });
        const vault = await fetchVault(auth.accessToken);
        const { app, policy, files, objectArtifacts } = vault.payload;

        const objectFiles = (objectArtifacts ?? []).map((a) => ({
          path: a.path,
          downloadUrl: a.downloadUrl ?? "",
          key: a.key,
          nonce: a.nonce,
          sha256: a.sha256,
          archive: a.archive ?? false,
        }));

        setView({
          status: "connecting",
          message:
            objectFiles.length > 0 ? "Downloading application…" : "Launching isolated sandbox…",
        });
        const sandbox = await startSandbox({
          tokenId: auth.tokenId,
          executable: app.executable,
          args: app.args,
          files,
          objectFiles,
          captureProtection: policy.captureProtection,
        });

        setUserSession({ sandbox, app, captureProtected: policy.captureProtection });
        setView({ status: "connecting", message: "Connecting to session server…" });
        connect(auth.accessToken, auth.tokenId, hwid, () => setView({ status: "user" }));
      } catch (err) {
        await teardown();
        // Tauri `invoke` rejects with a plain string; API errors are Error instances.
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string" && err.length > 0
              ? err
              : "Could not start the session.";
        setError(message);
        setView({ status: "login", prefill: token });
      }
    },
    [connect, teardown],
  );

  // Deep link handling: both the plugin callback and the Rust-forwarded event.
  useEffect(() => {
    const submitFromUrl = (url: string): void => {
      const token = tokenFromDeepLink(url);
      if (token) void handleSubmit(token);
    };
    const unlisteners: Array<() => void> = [];
    // Drain a deep link captured before this listener existed (first launch).
    void invoke<string | null>("take_pending_deep_link")
      .then((url) => {
        if (url) submitFromUrl(url);
      })
      .catch(() => undefined);
    void onOpenUrl((urls) => urls.forEach(submitFromUrl))
      .then((un) => unlisteners.push(un))
      .catch(() => undefined);
    void listen<string>("deep-link://redeem", (e) => submitFromUrl(e.payload))
      .then((un) => unlisteners.push(un))
      .catch(() => undefined);
    return () => unlisteners.forEach((un) => un());
  }, [handleSubmit]);

  const signOut = useCallback(() => void returnToLogin(null), [returnToLogin]);

  if (view.status === "login") {
    return (
      <>
        {banner && (
          <div className="banner banner--alert" role="alert">
            <ShieldAlert size={16} /> {banner}
            <button className="banner__close" onClick={() => setBanner(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        <LoginScreen onSubmit={handleSubmit} busy={false} error={error} prefillToken={view.prefill} />
      </>
    );
  }

  if (view.status === "connecting") {
    return (
      <div className="connecting">
        <Loader2 size={36} className="spin" />
        <p>{view.message}</p>
      </div>
    );
  }

  if (view.status === "owner") {
    return <OwnerHostScreen accessToken={view.accessToken} onSignOut={() => void quitApp()} />;
  }

  // user
  if (!userSession) return null;
  return (
    <UserSessionFrame
      sandbox={userSession.sandbox}
      executable={userSession.app.executable}
      paused={paused}
      linkState={linkState}
      captureProtected={userSession.captureProtected}
      onSignOut={signOut}
    />
  );
}
