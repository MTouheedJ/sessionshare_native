# Architecture & Technical Blueprint

## 1. System Overview
SessionShare is a secure session virtualization and sharing platform comprising three main modules:
1. **Web Admin Dashboard (React/Next.js)**: Centralized portal for owner management, token generation, user session tracking, and real-time control (pause/revoke/delete).
2. **Backend API & Realtime Server (NestJS / Node.js + Redis + PostgreSQL)**: Core service providing authentication, token lifecycle management, database persistence, and WebSocket signal broadcasting for instant status sync.
3. **SessionShare Desktop Application (Tauri + Rust + React)**: Cross-platform client app used by both the Owner and Normal Users. It embeds target application contexts in isolated sandboxes while hooking native window commands to enforce security rules.

## 2. Core Operational Workflow

### Phase A: Owner Pre-Authentication & Session Capture
1. The Owner authenticates into the Confidential Desktop App locally.
2. Owner launches `SessionShare.exe` and inputs their **Owner Master Token**.
3. `SessionShare.exe` verifies the token with the Backend API via WebSockets.
4. Upon authentication, `SessionShare.exe` securely extracts encrypted session state (cookies, local tokens, or sqlite profile state) or establishes a local sandboxed target runner.
5. The Owner session uploads the encrypted configuration profile to the Backend API Vault.

### Phase B: User Access & Isolated Execution
1. Normal Users receive `SessionShare.exe` along with a single-use **User Token**.
2. User runs `SessionShare.exe` and enters their assigned token.
3. The Backend API validates the token, ensuring it is active, non-expired, and not bound to another active HWID (Hardware ID).
4. The Backend transmits the encrypted profile payload down to the User's `SessionShare.exe`.
5. The app launches an isolated, sandboxed instance of the confidential app pre-loaded with the pre-authenticated state.
6. **Isolation Engine**: All local actions (searches, inputs, temporary files) are bound to a temporary memory virtual disk (RAM disk/isolated user data directory). No state is written back to the Owner or other Users.

---

## 3. High-Level System Architecture Diagram

```
+-------------------------------------------------------------------------+
|                        Web Dashboard (Next.js)                          |
|         [ Token Lifecycle | Live Monitoring | Session Control ]         |
+-------------------------------------------------------------------------+
                                     | (REST API / WSS)
                                     v
+-------------------------------------------------------------------------+
|                         Backend API (NestJS)                            |
|     [ Auth & Token Engine | WebSocket Gateway | Cryptographic Vault ]    |
+-------------------------------------------------------------------------+
                    |                                       |
          PostgreSQL (Persistent)                      Redis (Pub/Sub)
                    |                                       |
         +----------+---------------------------------------+----------+
         |                                                          |
         v (WSS Heartbeat & Vault Sync)                             v (WSS Heartbeat & Vault Sync)
+------------------------------------+             +------------------------------------+
|    Owner Desktop App (Tauri/Rust)  |             |     User Desktop App (Tauri/Rust)  |
| - Extracts Session State           |             | - Validates Token                  |
| - Syncs Vault Profile              |             | - Spawns Isolated Sandbox Instance |
| - Controls Live Stream State       |             | - Enforces Window Control Hooks    |
+------------------------------------+             +------------------------------------+
```

---

## 4. Communication & Synchronization Architecture

* **REST API**: Used for authentication, token generation, user listings, and historical logs.
* **WebSockets / SignalR**: Used for real-time bi-directional messaging:
  * **Heartbeat**: Desktop clients emit heartbeats every 5 seconds.
  * **Revocation/Pause Signal**: Dashboard issues `REVOKE` or `PAUSE` events to Redis Pub/Sub; the WebSocket gateway immediately forwards the payload to the specific user client connection, which instantly terminates the target app and wipes sandbox data.

---

## 5. Technology Stack Summary

| Component | Framework / Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend Dashboard** | Next.js 14, TailwindCSS, Shadcn UI | Admin Management Portal |
| **Backend Service** | NestJS (TypeScript), TypeORM / Prisma | Business Logic & API Layer |
| **Database** | PostgreSQL 16 | Relational Storage |
| **In-Memory Cache** | Redis 7 | Live Session Tracking & WebSocket Pub/Sub |
| **Desktop Application** | Tauri 2.0 (Rust backend + React frontend) | Native OS integration, lightweight UI |
| **Sandboxing Engine** | OS Native Win32 API / WebView2 Isolation | Preventing app closure, isolating profile directories |