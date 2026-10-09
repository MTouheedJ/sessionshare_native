# Object Storage for Large App Bundles (Supabase Storage)

Large app binaries don't belong inline in the vault DB row (base64 bloat + transport
drops). With object storage configured, binaries above a threshold are encrypted on
the client and uploaded **directly** to Supabase Storage via short-lived signed URLs;
the vault row keeps only small metadata (object key, per-artifact AES key, checksum).

- **Small files** (≤ `VAULT_INLINE_MAX_BYTES`, default 5 MB) stay inline — one round trip, instant.
- **Large files** go to object storage — the bytes never pass through the backend.
- **Zero-knowledge storage**: objects are AES-256-GCM ciphertext; the keys live only in
  the (separately encrypted) vault row. Compromising storage reveals nothing.

This is delivered in two phases. **Phase 1 (this doc) is the backend brokering**, which
you can verify now. Phase 2 wires the desktop client (encrypt → upload → download →
decrypt → extract) and the owner/user UI.

---

## 1. Supabase project setup (one-time)

1. In your Supabase project → **Storage** → **New bucket**:
   - Name: `vault-artifacts` (or set `SUPABASE_STORAGE_BUCKET` to match)
   - **Private** (not public). Signed URLs grant time-limited access.
2. Raise the per-file size limit to cover your largest bundle:
   - **Storage → Settings → Upload file size limit** → set e.g. `200 MB`.
   - Note: the free plan caps this (≈50 MB). Bundles larger than the cap need a paid
     plan, or use a self-hosted S3/MinIO instead.
3. Get your **service-role key**: **Project Settings → API → `service_role` secret**.
   This key bypasses RLS — keep it **server-side only**. Never put it in the desktop app.

## 2. Backend configuration

Add to `apps/backend-api/.env`:

```
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role secret>
SUPABASE_STORAGE_BUCKET=vault-artifacts
VAULT_INLINE_MAX_BYTES=5242880          # 5 MB; files above this go to storage
VAULT_SIGNED_URL_TTL_SECONDS=600        # signed URL lifetime
```

If `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are blank, storage is disabled and the
presign endpoints return `503` (everything else works as before, inline-only).

## 3. Verify (Phase 1)

With the backend running and the bucket created:

```
cd apps/backend-api
node scripts/verify-storage.cjs            # or: node scripts/verify-storage.cjs <API_BASE_URL>
```

It exercises the real round trip: presign upload → PUT 3 MB straight to Supabase →
presign download → GET → byte-compare, plus cross-owner isolation. All checks should
print `PASS`.

If `presign upload` returns 503, the env vars aren't set. If the direct PUT fails with
4xx, check the bucket name and the Storage upload size limit.

---

## Endpoints added (Phase 1)

| Method | Path | Auth | Purpose |
| :-- | :-- | :-- | :-- |
| POST | `/api/v1/owner/vault/artifacts/presign` | Owner desktop JWT | Signed URL to upload one encrypted artifact |
| POST | `/api/v1/owner/vault/artifacts/presign-download` | Desktop JWT (owner/user) | Signed URL to download an artifact owned by this identity |

Object keys are namespaced `"<ownerId>/<uuid>"`; download presign re-checks that the
requested key belongs to the caller's owner.
