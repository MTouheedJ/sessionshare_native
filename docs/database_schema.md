# Database Schema Specification

## 1. Relational Database (PostgreSQL)

```sql
-- Enum Types
CREATE TYPE token_type_enum AS ENUM ('OWNER', 'USER');
CREATE TYPE token_status_enum AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED', 'EXPIRED');
CREATE TYPE user_status_enum AS ENUM ('ONLINE', 'OFFLINE', 'BLOCKED');

-- 1. Owners / Admins Table
CREATE TABLE owners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Owner Master Tokens Table
CREATE TABLE owner_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) DEFAULT 'Primary Master Token',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE
);

-- 3. User Tokens Table
CREATE TABLE user_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    token_value VARCHAR(64) UNIQUE NOT NULL, -- Human-readable / random secure string
    status token_status_enum DEFAULT 'ACTIVE',
    max_uses INT DEFAULT 1,
    current_uses INT DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Session Logs & Connected Clients
CREATE TABLE active_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_token_id UUID REFERENCES user_tokens(id) ON DELETE SET NULL,
    hwid VARCHAR(255) NOT NULL, -- Hardware identifier to enforce single-device binding
    ip_address VARCHAR(45),
    client_version VARCHAR(20),
    status user_status_enum DEFAULT 'OFFLINE',
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    disconnected_at TIMESTAMP WITH TIME ZONE
);

-- 5. Session State Vault (Encrypted Confidential App Credentials)
CREATE TABLE session_vault (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    encrypted_payload TEXT NOT NULL, -- AES-256 encrypted authentication profile
    checksum VARCHAR(64) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance optimization
CREATE INDEX idx_user_tokens_value ON user_tokens(token_value);
CREATE INDEX idx_user_tokens_owner ON user_tokens(owner_id);
CREATE INDEX idx_active_sessions_hwid ON active_sessions(hwid);
CREATE INDEX idx_active_sessions_status ON active_sessions(status);
```

---

## 2. In-Memory Key-Value Store (Redis)

Redis is utilized for real-time user presence, heartbeat validation, and instant event propagation.

| Key Pattern | Data Type | Expiry | Purpose |
| :--- | :--- | :--- | :--- |
| `presence:user:{tokenId}` | Hash | 15s (auto-expire) | Stores `ip`, `hwid`, `last_heartbeat`, `status`. Updated every 5s by desktop app. |
| `token:status:{tokenId}` | String | Indefinite | Values: `ACTIVE`, `PAUSED`, `REVOKED`. Checked on every client request. |
| `pubsub:session_events` | Channel | N/A | Publishes action events: `{ tokenId: "...", action: "PAUSE" \| "REVOKE" }`. |