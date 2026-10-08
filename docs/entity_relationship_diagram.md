# Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    OWNERS ||--o{ OWNER_TOKENS : generates
    OWNERS ||--o{ USER_TOKENS : creates
    OWNERS ||--11 SESSION_VAULT : manages
    USER_TOKENS ||--o{ ACTIVE_SESSIONS : tracks

    OWNERS {
        uuid id PK
        string email UK
        string password_hash
        string full_name
        timestamp created_at
    }

    OWNER_TOKENS {
        uuid id PK
        uuid owner_id FK
        string token_hash UK
        string name
        boolean is_active
        timestamp last_used_at
    }

    USER_TOKENS {
        uuid id PK
        uuid owner_id FK
        string token_value UK
        enum status "ACTIVE | PAUSED | REVOKED | EXPIRED"
        int max_uses
        int current_uses
        timestamp expires_at
    }

    ACTIVE_SESSIONS {
        uuid id PK
        uuid user_token_id FK
        string hwid
        string ip_address
        string client_version
        enum status "ONLINE | OFFLINE | BLOCKED"
        timestamp last_heartbeat
    }

    SESSION_VAULT {
        uuid id PK
        uuid owner_id FK
        text encrypted_payload
        string checksum
        timestamp updated_at
    }
```