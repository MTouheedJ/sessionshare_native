import { io, type Socket } from "socket.io-client";
import { HEARTBEAT_INTERVAL_MS, REALTIME_URL } from "./config";
import type { ConnectionAck, DesktopControlPayload } from "./types";

export interface SessionSocketHandlers {
  onAck: (ack: ConnectionAck) => void;
  onPause: (payload: DesktopControlPayload) => void;
  onResume: (payload: DesktopControlPayload) => void;
  onTerminate: (payload: DesktopControlPayload) => void;
  onError: (message: string) => void;
  onDisconnect: () => void;
}

/**
 * Connects to `/ws/session` over WebSocket transport only (per Step 3 spec),
 * authenticates with the desktop JWT, and keeps a 5s heartbeat alive.
 */
export class SessionSocket {
  private socket: Socket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly accessToken: string,
    private readonly tokenId: string,
    private readonly hwid: string,
    private readonly version: string,
    private readonly handlers: SessionSocketHandlers,
  ) {}

  connect(): void {
    const socket = io(`${REALTIME_URL}/ws/session`, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000,
    });
    this.socket = socket;

    socket.on("connect", () => {
      socket.emit("client:connect", {
        token: this.accessToken,
        hwid: this.hwid,
        version: this.version,
      });
    });

    socket.on("server:connection_ack", (ack: ConnectionAck) => {
      this.handlers.onAck(ack);
      this.startHeartbeat();
    });
    socket.on("server:pause_session", (p: DesktopControlPayload) => this.handlers.onPause(p));
    socket.on("server:resume_session", (p: DesktopControlPayload) => this.handlers.onResume(p));
    socket.on("server:terminate_session", (p: DesktopControlPayload) => {
      this.stopHeartbeat();
      this.handlers.onTerminate(p);
    });
    socket.on("server:error", (e: { message?: string }) =>
      this.handlers.onError(e?.message ?? "Connection rejected"),
    );
    socket.on("disconnect", () => {
      this.stopHeartbeat();
      this.handlers.onDisconnect();
    });
    socket.on("connect_error", (err: Error) => this.handlers.onError(err.message));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const send = (): void => {
      this.socket?.emit("client:heartbeat", {
        tokenId: this.tokenId,
        hwid: this.hwid,
        timestamp: Date.now(),
      });
    };
    send();
    this.heartbeat = setInterval(send, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  /** Permanently closes the socket and stops reconnection. */
  close(): void {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
