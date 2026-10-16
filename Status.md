# SessionShare — Project Status & AI Handoff

> **Read this first** if you are an AI agent (Claude or otherwise) picking up this repo.
> It explains what the project is, how it works, what is done, what is not, how to run it,
> and the decisions that look like bugs but are deliberate. Last updated: **2026-10-16**
> (branch `v3`, based on `main` @ `9b3b288`, "v2 the app is currently being shared - done").

---

## 1. The idea in one paragraph

SessionShare lets an **Owner** share a desktop application (and its logged-in state) with
**Users** without sharing credentials and **without screen streaming**. The Owner bundles the
app's files into an **encrypted vault** on the backend. A User redeems a **token** in the
SessionShare desktop client; the client checks the token against the user's hardware ID (HWID),
downloads and decrypts the bundle, and runs the app **locally as an isolated process inside a
temporary sandbox folder**. The Owner watches every live session in a **web dashboard** and can
**pause, resume, kick or revoke** it in real time. When a session is revoked, the client kills
the process and deletes the sandbox files.

The core rule (from `docs/development_coding_instructions.md`) is: **no VNC, WebRTC or RDP screen
sharing.** Each user gets their own local execution, so one user's input never shows up on
another user's screen.

---

## 2. Monorepo layout

| Path | Stack | Role | Dev port |
| :-- | :-- | :-- | :-- |
| `apps/backend-api` | NestJS 11, TypeORM, PostgreSQL 16, Redis 7, Socket.io | Auth, tokens, vault, object-storage broker, realtime gateways | `3000` (prefix `/api/v1`) |
| `apps/web-dashboard` | Next.js 16, React 19, Tailwind, TanStack Query | Owner admin console (BFF proxy, httpOnly cookie JWT) | `3001` |
| `apps/desktop-app` | Tauri 2, Rust, React + Vite | One binary for both roles: Owner host screen and User sandbox client | `1420` (Vite dev) |
| `docker-compose.yml` | postgres:16-alpine, redis:7-alpine | Local infrastructure | `5432`, `6379` |
| `docs/` | Markdown specs | Architecture, DB schema, API, security/isolation, UI/UX, object storage setup | — |
| `README.md` | — | Full self-hosting / deploy guide and env-var reference (**authoritative for env vars**) | — |

---

## 3. How it works (end-to-end flow)

```
Owner (dashboard)  ──register/login──▶  backend  ◀──Postgres (users, tokens, vault, logs)
      │ creates OWNER token (sso_…)          │  ◀──Redis (token status cache, presence, pub/sub)
      ▼                                      │  ──▶ Cloudflare R2 (large encrypted bundles, optional)
Owner (desktop app) signs in with sso_… ─────┤
  picks files OR a folder, main exe, policy  │
  → files ≤5MB inline in vault               │
  → larger files / folder zip: encrypted     │
    client-side (AES-256-GCM) → PUT to R2    │
    via presigned URL                        │
  → POST /owner/vault/upload                 │
                                             │
Owner (dashboard) creates USER token (SS-…) or sessionshare://redeem?token=… link
                                             │
User (desktop app) enters token / clicks link
  → POST /tokens/validate {token, hwid}  → desktop JWT (15 min), binds HWID
  → GET  /owner/vault/fetch               → payload + fresh signed download URLs
  → Rust start_sandbox: create %TEMP%/SessionShare_Sandbox_{tokenId}/,
    write inline files, download+decrypt+sha256-verify object files, unzip archives,
    resolve relative exe inside sandbox, spawn process, apply capture protection
  → Socket.io /ws/session: connect + heartbeat every 5s
                                             │
Owner (dashboard) pause/resume/revoke ─▶ Redis pub/sub ─▶ server:pause_session / resume / terminate
  → client shows PauseOverlay, or kills the process tree (taskkill /T /F) and deletes the sandbox
```

### Token types
- **OWNER token** (`sso_…`): signs the Owner into the desktop app's **Owner Host Engine** so they can publish a vault.
- **USER token** (`SS-…`): redeemed by Users. It binds to an HWID on first use. Status can be ACTIVE, PAUSED, REVOKED or DELETED.

### Auth layers
- **Dashboard owner JWT** (`jwt` strategy, `JwtAuthGuard`, 1h). Stored in an httpOnly cookie by the Next.js BFF. The browser never sees it.
- **Desktop JWT** (`desktop-jwt` strategy, `DesktopAuthGuard`, scope `desktop`, 15 min). Bound to the HWID.
- **WS ticket** (60s). Short-lived JWT the dashboard uses for the Socket.io handshake (`POST /auth/ws-ticket`).

### Encryption
- **Vault row**: AES-256-GCM on the server, with `VAULT_ENCRYPTION_KEY` (32-byte base64) and the owner id as AAD.
- **Large artifacts**: AES-256-GCM on the **client**, with a random key and nonce per artifact (Rust `artifact.rs`). R2 only holds ciphertext. The per-artifact key, nonce and sha256 are stored inside the encrypted vault row, so storage stays zero-knowledge.

---

## 4. Backend API surface (`/api/v1`)

| Route | Guard | Purpose |
| :-- | :-- | :-- |
| `POST /auth/register`, `POST /auth/login` | — | Owner account |
| `POST /auth/ws-ticket` | owner JWT | Dashboard socket ticket |
| `GET /tokens`, `POST /tokens/generate` (alias `/tokens/user`) | owner JWT | List/create user tokens |
| `PATCH /tokens/:id/status`, `DELETE /tokens/:id` | owner JWT | Pause/resume/revoke/delete |
| `POST /tokens/owner` | owner JWT | Create owner master token |
| `POST /tokens/validate` | — | Desktop redeem: token + HWID → desktop JWT |
| `GET/POST /owner/tokens`, `POST /owner/tokens/:id/revoke` | owner JWT | Owner token management |
| `GET /sessions`, `POST /sessions/:id/terminate`, `POST /sessions/:id/unblock` | owner JWT | Live sessions |
| `POST /owner/vault/upload` | desktop JWT (owner) | Publish vault (body limit `VAULT_BODY_LIMIT`, default 256mb) |
| `GET /owner/vault/fetch` | desktop JWT (owner or bound user) | Fetch vault + fresh signed download URLs |
| `POST /owner/vault/artifacts/presign` | desktop JWT (owner) | Presigned R2 PUT |
| `POST /owner/vault/artifacts/presign-download` | desktop JWT | Presigned R2 GET (checks the key starts with `<ownerId>/`) |

WebSocket namespaces: `/ws/session` (desktop: connect + heartbeat; server pushes
`server:pause_session` / resume / terminate) and `/ws/dashboard` (live feed for the owner).
`PresenceSweeperService` marks a session OFFLINE after it misses heartbeats for 15s.

Key files: `src/main.ts` (CORS, per-route body limits), `src/config/env.ts` (all config),
`src/modules/{auth,tokens,sessions,vault,storage,realtime}`, `src/database/entities`,
`src/redis/redis-keys.ts`.

---

## 5. Desktop app internals (`apps/desktop-app`)

**Frontend (`src/`)**
- `App.tsx`: state machine (login → connecting → owner | user). Handles redeem, deep links, socket and teardown.
- `components/LoginScreen.tsx`: token entry.
- `components/OwnerHostScreen.tsx`: picks **files** or a **folder**, chooses the main exe, sets the policy (capture protection, clipboard), then uploads. The mode is a `Selection = files | folder` discriminated union.
- `components/UserSessionFrame.tsx` + `PauseOverlay.tsx`: control frame shown while the user's app runs.
- `lib/api.ts` (REST), `lib/session-socket.ts` (Socket.io), `lib/native.ts` (Tauri `invoke` wrappers), `lib/types.ts`, `lib/config.ts` (reads `VITE_*`).

**Rust (`src-tauri/src/`)**
- `lib.rs`: Tauri commands: `get_hwid`, `stat_files`, `read_files_b64`, `zip_folder`, `upload_artifact`, `start_sandbox` (async), `set_capture_protection`, `cleanup_sandbox`, `quit_app`, `take_pending_deep_link`. Also sets up the deep-link and single-instance plugins.
- `sandbox.rs`: creates the sandbox directory. `safe_join` blocks path traversal. `extract_zip` is zip-slip safe. `resolve_executable` turns a relative exe path into an **absolute** path inside the sandbox; Windows `CreateProcess` resolves a relative path against the parent's cwd, not the child's, which is why the absolute path is required. Process trees are killed with `taskkill /T /F`, and the folder is deleted on cleanup.
- `artifact.rs`: `encrypt_and_upload`, `download_and_decrypt` (sha256 check, emits `download-progress`), `zip_dir`.
- `hwid.rs`: SHA-256 of MachineGuid + BIOS registry values + COMPUTERNAME. It is deterministic and does not use WMI.
- `window_control.rs`: `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` plus a close guard.

**Important isolation caveat:** the shared app runs as a **separate OS process**. It is **not**
embedded or reparented into the Tauri window, because doing that reliably for arbitrary apps is
not feasible. The Tauri window is a *control frame*: pause overlay, status, close guard and
capture protection apply to that frame. Terminate and revoke kill the real process.

---

## 6. What is DONE ✅

- **Step 1–2 — Backend + dashboard**: owner auth, owner/user tokens, HWID binding, sessions, Redis presence and heartbeats, realtime pause/resume/revoke over Redis pub/sub, dashboard pages (overview, tokens, sessions, login, register) with a BFF proxy.
- **Step 3 — Desktop client**: owner host, user redeem, sandbox spawn, `sessionshare://` deep links (including the first-launch race fix), single instance, capture protection, pause overlay, secure cleanup.
- **Step 4 — Release**: TypeORM migrations (`1791469995766-InitialSchema.ts`), prod config (`DB_SYNCHRONIZE=false`), and MSI and NSIS installers. The README is the deploy guide.
- **Zero-install bundling**: the Owner bundles the app's binaries, so the User does not need the app installed.
- **Object storage (Cloudflare R2)**: files over 5MB go to R2 via presigned URLs and are encrypted client-side. This replaced Supabase Storage on 2026-10-12. The S3 client **must** set `requestChecksumCalculation` / `responseChecksumValidation` to `'WHEN_REQUIRED'`, or R2 returns `403 SignatureDoesNotMatch`.
- **Folder bundling**: a whole app folder is zipped, sent as one encrypted object with `archive: true` and `path: "app"`, and extracted in the sandbox. This works for multi-file apps with nested directories.
- **Latest milestone** (commit `71a64c9`, merged in PR #1): an app is shared successfully end-to-end.
- Rust unit tests cover crypto round trip, tamper detection, `resolve_executable` and zip folder-tree preservation.

## 7. What is NOT done / known gaps ⚠️

- **Clipboard blocking is not enforced.** `policy.blockClipboard` is collected in the UI and stored in the vault, but nothing in Rust acts on it yet. The spec asks to disable Ctrl+C/V out of the target.
- **Capture protection and pause only cover the Tauri control frame**, not the spawned app's own windows. The spawned app could still be screen-captured, and pause does not freeze the target process.
- **Sandbox is filesystem-level only.** It is a dedicated temp directory used as cwd. There is no AppContainer or Job Object, and no registry/profile virtualization. Apps that need an installer, registry keys or their own profile paths may not run portably.
- **Windows-first.** `hwid`, capture protection and `taskkill` are Windows implementations. Other OSes get stubs.
- Bundle limits: the inline vault is capped by `VAULT_BODY_LIMIT` (256mb). R2 has no per-file cap.
- Automated test coverage is light: a backend spec/e2e skeleton and Rust unit tests. There are no frontend tests.

---

## 8. Deliberate decisions — do NOT "fix" without asking the user

1. **`user_tokens.max_uses` counts distinct HWID bindings, not launches.** A bound device can re-validate without limit, which refreshes its JWT and reuses its `active_sessions` row. A new HWID uses up a slot. The docs say "1 token = 1 HWID", and that holds only for the default `max_uses = 1`. Because of this, Redis presence keys are **per session** (`presence:session:{id}`), not per token.
2. **Hybrid storage**: files ≤ `VAULT_INLINE_MAX_BYTES` (5MB) stay inline in the DB row, and everything larger goes to R2.
3. **Desktop CORS**: the desktop webview calls the API directly, so `DESKTOP_ORIGINS` must include the Tauri origins. The dashboard does not need REST CORS because it goes through its same-origin BFF.
4. **Tauri `invoke` rejects with a plain string**, not an `Error`. Catch blocks must handle both (see `App.tsx`).
5. The initial migration was generated against an empty throwaway DB. Generate future migrations with `migration:generate` after you change entities.

---

## 9. Essentials (prerequisites)

- Node.js 20+ (tested on 24) and npm
- Docker + Docker Compose (or your own Postgres 16 / Redis 7)
- Rust stable + Tauri prerequisites (Windows: MSVC C++ Build Tools + WebView2)
- Optional: a Cloudflare R2 bucket and API token, needed for bundles over 5MB and for folder bundles (see `docs/object_storage_setup.md`)

### Env files (do not commit real values; names only)
- `apps/backend-api/.env` (copy from `.env.example`). **Required:** `JWT_SECRET`, `VAULT_ENCRYPTION_KEY`. The rest: `DB_*`, `DB_SYNCHRONIZE`, `DB_MIGRATIONS_RUN`, `REDIS_URL`, `DASHBOARD_ORIGINS`, `DESKTOP_ORIGINS`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `VAULT_INLINE_MAX_BYTES`, `VAULT_SIGNED_URL_TTL_SECONDS`, `JWT_*_EXPIRES_IN_SECONDS`.
- `apps/web-dashboard/.env.local`: `BACKEND_API_URL` (server-side), `NEXT_PUBLIC_REALTIME_URL` (browser).
- `apps/desktop-app/.env` / `.env.local`: `VITE_API_BASE_URL`, `VITE_REALTIME_URL`. These are **baked in at build time**. For a remote or ngrok backend, also widen the CSP in `src-tauri/tauri.conf.json` and add the origin to the backend's `DESKTOP_ORIGINS`.

---

## 10. Commands

```bash
# 0. Infrastructure
docker compose up -d                       # Postgres :5432, Redis :6379

# 1. Backend
cd apps/backend-api
npm install
cp .env.example .env                       # then set JWT_SECRET + VAULT_ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # VAULT_ENCRYPTION_KEY
npm run start:dev                          # http://localhost:3000/api/v1
npm run build && npm run start:prod        # production
npm run lint                               # oxlint
npm test                                   # jest
npm run migration:run:dev                  # apply migrations (ts-node)
npm run migration:generate src/database/migrations/<Name>
npm run migration:run                      # prod (needs build first)
node scripts/verify-storage.cjs            # live R2 round-trip check

# 2. Dashboard
cd apps/web-dashboard
npm install
npm run dev                                # http://localhost:3001
npm run typecheck && npm run lint
npm run build && npm run start

# 3. Desktop
cd apps/desktop-app
npm install
npm run tauri dev                          # dev window
npm run tauri build                        # ~11 min cold; installers below
cd src-tauri && cargo test                 # Rust unit tests
```

Release outputs are in `apps/desktop-app/src-tauri/target/release/`:
`desktop-app.exe`, `bundle/msi/SessionShare_0.1.0_x64_en-US.msi`, and
`bundle/nsis/SessionShare_0.1.0_x64-setup.exe`. Installing registers the `sessionshare://` scheme.

> Note: if `DB_SYNCHRONIZE=false` in your `.env` (the `.env.example` default), run
> `npm run migration:run:dev` once on a fresh DB, or set `DB_SYNCHRONIZE=true` for local dev.

### Manual smoke test
1. Dashboard → register → Tokens → create an **Owner master token** (`sso_…`).
2. Desktop → sign in with `sso_…` → Owner Host Engine → *Choose files* or *Choose a folder* → pick the main exe → *Encrypt & publish to vault*.
3. Dashboard → Tokens → *Generate token* (`SS-…`) → copy the token or the `sessionshare://redeem?token=…` link.
4. Desktop (user machine) → paste the token → the app downloads, decrypts and launches in the sandbox.
5. Dashboard → Sessions → pause / resume / revoke. The client should react within about 500ms. On revoke the process is killed and `%TEMP%/SessionShare_Sandbox_*` is deleted.

---

## 11. Coding rules for agents (from `docs/development_coding_instructions.md`)

- Strict TypeScript, **no `any`**. Use safe Rust, with `unsafe` only for Win32 window-control calls.
- Keep routes, entities and gateways decoupled (one Nest module per concern).
- Never introduce screen streaming. Isolation means local sandboxed execution.
- Revoke or delete must kill the process and wipe decrypted files immediately.
- Heartbeat every 5s, OFFLINE after 15s. Admin actions go through Redis pub/sub in under 500ms.
- Server-side secrets (R2 keys, `VAULT_ENCRYPTION_KEY`, `JWT_SECRET`) must never reach clients.

## 12. Further reading
`docs/architecture_documentation.md`, `docs/api_specifications.md`, `docs/database_schema.md`,
`docs/entity_relationship_diagram.md`, `docs/security_and_isolation_specifications.md`,
`docs/ui_and_ux_design_document.md`, `docs/object_storage_setup.md`, and `README.md`.
