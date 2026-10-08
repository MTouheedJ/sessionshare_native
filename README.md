# SessionShare

Secure session virtualization and sharing platform. An **Owner** captures a pre‑authenticated
application profile into an encrypted vault; **Users** redeem single‑device tokens to launch that
app inside an isolated local sandbox, while the Owner monitors and controls every live session in
real time (pause / resume / revoke) from a web dashboard.

This is a monorepo with three apps plus local infrastructure:

| Workspace | Stack | Purpose | Dev port |
| :-- | :-- | :-- | :-- |
| `apps/backend-api` | NestJS · TypeORM · PostgreSQL · Redis · Socket.io | Auth, tokens, vault, realtime gateway | `3000` |
| `apps/web-dashboard` | Next.js 16 · React 19 · Tailwind | Owner admin console | `3001` |
| `apps/desktop-app` | Tauri 2 · Rust · React | Owner host + User sandbox client | `1420` (dev) |
| `docker-compose.yml` | PostgreSQL 16 · Redis 7 | Local database + cache | `5432`, `6379` |

---

## 1. Prerequisites

- **Node.js 20+** (built and tested on 24) and npm
- **Docker** + Docker Compose (for local Postgres/Redis), or your own Postgres 16 / Redis 7
- **Rust** stable toolchain (desktop app only) — https://rustup.rs
- Tauri's OS build dependencies (desktop app only) — see https://tauri.app/start/prerequisites
  - Windows: Microsoft C++ Build Tools + WebView2 (preinstalled on Win 11)

Dependencies for all three apps are committed under each workspace's `node_modules`. If you start
fresh, run `npm install` inside each `apps/*` directory.

---

## 2. Local development

### 2.1 Start infrastructure

```bash
docker compose up -d          # Postgres on :5432, Redis on :6379
```

### 2.2 Configure the backend

```bash
cd apps/backend-api
cp .env.example .env
# Generate the two required secrets and paste them into .env:
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('VAULT_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

`JWT_SECRET` and `VAULT_ENCRYPTION_KEY` are **required** — the server refuses to boot without them.

### 2.3 Run the apps (three terminals)

```bash
# Terminal 1 — backend API + realtime gateway
cd apps/backend-api && npm run start:dev          # http://localhost:3000

# Terminal 2 — web dashboard
cd apps/web-dashboard && npm run dev              # http://localhost:3001

# Terminal 3 — desktop client (opens the Tauri window)
cd apps/desktop-app && npm run tauri dev
```

In development the backend auto-creates the schema (`DB_SYNCHRONIZE` defaults to `true` in dev), so
no migration step is needed to get started. Open http://localhost:3001, register an owner account,
generate tokens, and redeem one in the desktop app.

### 2.4 Typical end-to-end flow

1. **Dashboard** → register owner → **Tokens** → create an *Owner master token*.
2. **Desktop app** → sign in with the `sso_…` owner token → **Owner Host Engine** → set the target
   app path + isolation policy → *Encrypt & publish to vault*.
3. **Dashboard** → **Tokens** → *Generate token* (a `SS-…` user token) → copy it or the
   `sessionshare://` link.
4. **Desktop app** on the user's machine → paste the user token (or click the deep link) → the app
   validates, fetches the vault, and launches the target in an isolated sandbox.
5. **Dashboard** → **Sessions** / **Tokens** → pause, resume, kick, or revoke in real time.

---

## 3. Environment variable reference

### 3.1 Backend (`apps/backend-api/.env`)

| Variable | Required | Default | Description |
| :-- | :-- | :-- | :-- |
| `NODE_ENV` | no | `development` | `production` disables schema auto-sync by default. |
| `PORT` | no | `3000` | HTTP + WebSocket listen port. |
| `DB_HOST` | no | `localhost` | PostgreSQL host. |
| `DB_PORT` | no | `5432` | PostgreSQL port. |
| `DB_USER` | no | `admin` | PostgreSQL user. |
| `DB_PASSWORD` | no | `secretpassword` | PostgreSQL password. |
| `DB_NAME` | no | `sessionshare` | PostgreSQL database name. |
| `DB_SYNCHRONIZE` | no | `true` dev / `false` prod | Auto-create schema from entities. **Keep `false` in production.** |
| `DB_MIGRATIONS_RUN` | no | `false` | Run pending migrations automatically on boot. |
| `REDIS_URL` | no | `redis://localhost:6379` | Redis connection URL. |
| `JWT_SECRET` | **yes** | — | HMAC secret for all JWTs. |
| `JWT_EXPIRES_IN_SECONDS` | no | `3600` | Owner dashboard JWT lifetime. |
| `JWT_DESKTOP_EXPIRES_IN_SECONDS` | no | `900` | Hardware-bound desktop JWT lifetime. |
| `JWT_WS_TICKET_EXPIRES_IN_SECONDS` | no | `60` | Dashboard WebSocket handshake ticket lifetime. |
| `DASHBOARD_ORIGINS` | no | `http://localhost:3001` | Comma-separated origins allowed for the dashboard (CORS + WS). |
| `DESKTOP_ORIGINS` | no | Tauri localhost origins | Comma-separated origins allowed for the desktop webview (CORS + WS). |
| `VAULT_ENCRYPTION_KEY` | **yes** | — | 32-byte base64 AES-256-GCM key for the session vault. |

### 3.2 Web dashboard (`apps/web-dashboard/.env.local`)

| Variable | Required | Default | Description |
| :-- | :-- | :-- | :-- |
| `BACKEND_API_URL` | no | `http://localhost:3000/api/v1` | **Server-side** API base URL used by the dashboard's BFF route handlers. The JWT lives in an httpOnly cookie and never reaches the browser. |
| `NEXT_PUBLIC_REALTIME_URL` | no | `http://localhost:3000` | **Browser** Socket.io origin for the live feed. Must be reachable from the user's browser. |

### 3.3 Desktop app (`apps/desktop-app/.env`, build-time)

These are baked into the bundle at build time by Vite.

| Variable | Required | Default | Description |
| :-- | :-- | :-- | :-- |
| `VITE_API_BASE_URL` | no | `http://localhost:3000/api/v1` | Backend REST API base URL. |
| `VITE_REALTIME_URL` | no | `http://localhost:3000` | Backend Socket.io origin. |

> When building the desktop app for a remote server you must **also** widen the webview Content
> Security Policy in `apps/desktop-app/src-tauri/tauri.conf.json` (`app.security.csp`) to include
> your API/WS origins, and add those origins to the backend's `DESKTOP_ORIGINS`.

---

## 4. Self-hosting / production deployment

The three services are independent processes. A common layout: backend + Postgres + Redis on a
server behind a reverse proxy (TLS), dashboard on the same or another host, and the desktop
installer distributed to users.

### 4.1 Database (PostgreSQL 16)

Provision a database and a role, e.g.:

```sql
CREATE ROLE sessionshare LOGIN PASSWORD 'strong-password';
CREATE DATABASE sessionshare OWNER sessionshare;
```

`gen_random_uuid()` is built into PostgreSQL 13+, so no extension is required.

### 4.2 Backend API

```bash
cd apps/backend-api
npm ci                      # or: npm install
cp .env.example .env        # fill in production values (see §3.1)
#   NODE_ENV=production
#   DB_SYNCHRONIZE=false     <-- important
#   strong JWT_SECRET and VAULT_ENCRYPTION_KEY
#   DB_* / REDIS_URL pointing at your infra
#   DASHBOARD_ORIGINS / DESKTOP_ORIGINS set to your real origins

npm run build               # compiles to dist/
npm run migration:run       # applies the schema (uses dist/database/data-source.js)
npm run start:prod          # node dist/main
```

Run `start:prod` under a process manager (systemd, pm2, Docker, …) and put it behind a reverse
proxy that terminates TLS and forwards both HTTP and WebSocket upgrades to `PORT`.

**Back up `VAULT_ENCRYPTION_KEY`.** It decrypts every stored session vault; losing it makes all
vault payloads unrecoverable, and rotating it requires re-publishing every vault.

#### Database migrations

The schema is managed with TypeORM migrations in `apps/backend-api/src/database/migrations`.

| Command | When | Notes |
| :-- | :-- | :-- |
| `npm run migration:run` | Production deploy | Applies pending migrations against compiled `dist/`. Requires `npm run build` first. |
| `npm run migration:run:dev` | Local | Same, via ts-node without building. |
| `npm run migration:generate src/database/migrations/<Name>` | After entity changes | Diffs entities vs. the DB and writes a new migration. |
| `npm run migration:revert` | Rollback | Reverts the last applied migration. |
| `npm run migration:show` | Inspect | Lists applied / pending migrations. |

Alternatively set `DB_MIGRATIONS_RUN=true` to apply pending migrations automatically on boot.
Never enable `DB_SYNCHRONIZE` in production.

### 4.3 Web dashboard

```bash
cd apps/web-dashboard
npm ci
# .env.local:
#   BACKEND_API_URL=https://api.your-domain.example/api/v1      (server-to-server)
#   NEXT_PUBLIC_REALTIME_URL=https://api.your-domain.example    (browser-reachable)
npm run build
npm run start               # serves on :3001 (next start -p 3001)
```

Add the dashboard's public origin to the backend's `DASHBOARD_ORIGINS`. The dashboard calls the API
server-side through its own route handlers (a BFF proxy), so the browser only ever talks to the
dashboard origin plus the realtime URL.

### 4.4 Redis

Any Redis 7 instance reachable at `REDIS_URL`. Used for token-status caching, presence/heartbeat
tracking, and cross-instance pub/sub. Running multiple backend instances is supported because all
realtime events flow through Redis pub/sub.

### 4.5 Reverse proxy notes

- Forward WebSocket upgrades (`/ws/session`, `/ws/dashboard`, and Socket.io's `/socket.io/`) to the
  backend, not just plain HTTP.
- Terminate TLS at the proxy; point `NEXT_PUBLIC_REALTIME_URL` / `VITE_REALTIME_URL` at the `https`
  origin (Socket.io upgrades to `wss` automatically).

---

## 5. Desktop installer

### 5.1 Build

```bash
cd apps/desktop-app
# optional: cp .env.example .env and set VITE_* for your server (see §3.3)
npm run tauri build
```

### 5.2 Output location

Installers and the standalone binary are written under
`apps/desktop-app/src-tauri/target/release/`:

| Artifact | Path |
| :-- | :-- |
| Standalone executable | `target/release/desktop-app.exe` |
| MSI installer | `target/release/bundle/msi/SessionShare_<version>_x64_en-US.msi` |
| NSIS setup installer | `target/release/bundle/nsis/SessionShare_<version>_x64-setup.exe` |

> The raw binary is named `desktop-app.exe` (the Cargo package name); the **installed**
> application and the installers are branded **SessionShare** (the Tauri `productName`). For the
> current build (v0.1.0): `SessionShare_0.1.0_x64_en-US.msi` and
> `SessionShare_0.1.0_x64-setup.exe`.

(On macOS/Linux the bundler emits `.dmg` / `.app` / `.AppImage` / `.deb` under the same
`bundle/` directory instead.)

### 5.3 Usage

- Distribute the `.msi` (enterprise/MDM) or the NSIS `-setup.exe` (interactive install) to users.
- Installation registers the `sessionshare://` URI scheme, so `sessionshare://redeem?token=…`
  links (copied from the dashboard's **Tokens** page) launch and auto-redeem.
- The app is single-instance: a deep link opened while it's already running is forwarded to the
  existing window.
- Each token binds to one device's hardware ID on first use; a second device is rejected.

---

## 6. Repository layout

```
sessionshare_native/
├── apps/
│   ├── backend-api/      NestJS API, realtime gateway, vault, migrations
│   ├── web-dashboard/    Next.js owner console
│   └── desktop-app/      Tauri owner host + user sandbox client
├── docs/                 Architecture, schema, API, security specs
└── docker-compose.yml    Local Postgres + Redis
```

See `docs/` for the architecture blueprint, database schema, API specification, and the security /
isolation design.
