# STRICT DEVELOPMENT & ARCHITECTURAL INSTRUCTIONS FOR CLAUDE

> **Notice to AI Agent (Claude)**: Read these guidelines carefully before writing any code. Deviating from these principles will break security and core system requirements.

---

## 1. Core Mandate: Process & State Isolation

1. **DO NOT USE SIMPLE SCREEN STREAMING (VNC/WebRTC/RDP)**:
   * Screen sharing causes all users to see each other's cursor moves, inputs, and search results.
   * **Requirement**: You must implement **Isolated Sandboxed Execution**. The Owner's auth state (cookies/vault) is fetched by the user client and executed inside an isolated, local virtual context (isolated profile data directory/WebView2/Container).
   * **User A's inputs MUST NOT alter User B's screen or the Owner's screen.**

2. **Single-User Token Enforcement**:
   * Every token generated is strictly bound to 1 Hardware ID (`HWID`) upon initial access.
   * If a second device attempts to use an active token, reject the authentication request immediately.

---

## 2. Desktop Application Enforcements (Tauri / Rust)

1. **Process Hooking & Termination Protection**:
   * Users MUST NOT be able to close or terminate the embedded target app directly from inside the UI frame.
   * Intercept `WM_CLOSE` / `ALT + F4` keybindings inside the Tauri window frame.

2. **Data Loss Prevention (DLP)**:
   * Disable native clipboard copying (`Ctrl+C` / `Ctrl+V`) from the embedded target window to the host OS.
   * Set `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on Windows target frames to block screen-recording and screen-capturing software.

3. **Secure Cleanup**:
   * When a token is **REVOKED** or **DELETED**, the client app MUST immediately terminate the sandboxed application process and permanently sanitize (delete) all temporary decrypted vault payload files from the local storage disk.

---

## 3. Real-Time Communication Rules

1. **Heartbeat Protocol**:
   * Client apps send a `ping` event every 5 seconds over WebSockets containing `token`, `hwid`, and `timestamp`.
   * If backend misses 3 consecutive heartbeats (15s), mark session as `OFFLINE`.

2. **Instant Event Propagation**:
   * Admin actions on the Web Dashboard (Pause, Revoke, Update) MUST be published to Redis Pub/Sub and pushed down the active WebSocket connection within 500ms.

---

## 4. Code Structure & Quality Rules

* Use TypeScript strictly on Frontend & Backend (no `any` types).
* Use Rust safely in Tauri without `unsafe` blocks unless interfacing directly with Win32 APIs for window control hooks.
* Maintain clean module separation: keep API routes, database models, and WebSocket gateways decoupled.