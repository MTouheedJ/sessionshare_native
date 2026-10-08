# Security & Process Isolation Architecture

## 1. HWID (Hardware Identification) Generation
To ensure 1 token cannot be shared across multiple machines, the Desktop App calculates a deterministic SHA-256 hash derived from host components:
* Windows CPU ID
* Motherboard Serial Number
* Primary MAC Address

```
HWID = SHA256(CPU_ID + MOTHERBOARD_SERIAL + MAC_ADDR)
```

## 2. Data Encryption Pipeline
1. **At Rest**: Session Vault configurations stored in PostgreSQL are encrypted using AES-256-GCM using an encryption key stored securely in environment variables.
2. **In Transit**: All WebSocket and REST API communications enforce TLS 1.3. Payload transfers containing session vault tokens carry short-lived ephemeral tokens.

## 3. Sandboxed Profile Isolation Logic
When a user launches `SessionShare.exe` with a token:
1. App requests session payload from the vault.
2. Creates a isolated temporary directory: `%TEMP%/SessionShare_Sandbox_{TokenID}/`.
3. Injects encrypted profile state into the sandboxed directory.
4. Spawns target executable bound strictly to this temporary data directory.
5. On Session end / Revoke, executes `SHRED` / recursive deletion on `%TEMP%/SessionShare_Sandbox_{TokenID}/`.