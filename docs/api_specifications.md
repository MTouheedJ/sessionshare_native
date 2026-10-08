# API & Realtime WebSocket Specifications

## 1. REST Endpoints

### Auth & Owner
* `POST /api/v1/auth/register` - Create owner account.
* `POST /api/v1/auth/login` - Authenticate owner & return JWT token.

### Master Tokens (Owner Desktop)
* `POST /api/v1/owner/tokens` - Generate new master owner token.
* `POST /api/v1/owner/vault/upload` - Upload encrypted auth state payload from owner app.
* `GET /api/v1/owner/vault/fetch` - Fetch encrypted session state (requires valid token).

### User Token Management (Web Dashboard)
* `GET /api/v1/tokens` - List all generated user tokens with connection status.
* `POST /api/v1/tokens/generate` - Generate new single-use token.
* `PATCH /api/v1/tokens/:id/status` - Change status (`ACTIVE`, `PAUSED`, `REVOKED`).
* `DELETE /api/v1/tokens/:id` - Permanently delete token.

---

## 2. WebSocket Gateway Events (`/ws/session`)

### Client -> Server
* `client:connect` Payload: `{ token: string, hwid: string, version: string }`
* `client:heartbeat` Payload: `{ tokenId: string, hwid: string }`

### Server -> Client
* `server:connection_ack` - Authentication success & configuration payload.
* `server:pause_session` - Force client into paused screen lock.
* `server:resume_session` - Resume client access.
* `server:terminate_session` - Force immediate client exit and local state wipe.