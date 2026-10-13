# Object Storage for Large App Bundles (Cloudflare R2)

Large app binaries don't belong inline in the vault DB row (base64 bloat + transport
drops). With object storage configured, binaries above a threshold — and **all folder
bundles** — are encrypted on the client and uploaded **directly** to Cloudflare R2
(S3-compatible) via short-lived presigned URLs; the vault row keeps only small metadata
(object key, per-artifact AES key, checksum).

- **Small files** (≤ `VAULT_INLINE_MAX_BYTES`, default 5 MB) stay inline — one round trip, instant.
- **Large files / folder bundles** go to R2 — the bytes never pass through the backend.
- **Zero-knowledge storage**: objects are AES-256-GCM ciphertext; the keys live only in
  the (separately encrypted) vault row. Compromising storage reveals nothing.

R2 has **no per-file size cap** and **zero egress fees**. Its free tier (10 GB storage,
1M writes + 10M reads/month) is enough to test 150 MB+ bundles at no cost.

---

## 1. Cloudflare R2 setup (one-time)

1. Cloudflare dashboard → **R2** → enable it (you add a payment method, but usage within
   the free tier is not billed).
2. **Create bucket**: name `vault-artifacts` (or set `R2_BUCKET` to match). Keep it private.
3. **R2 → Manage API Tokens → Create API Token**:
   - Permission: **Object Read & Write**, scoped to the bucket.
   - Copy the **Access Key ID** and **Secret Access Key** (shown once).
4. Note your **Account ID** (R2 overview page) — the S3 endpoint is
   `https://<account-id>.r2.cloudflarestorage.com`.

## 2. Backend configuration

Add to `apps/backend-api/.env`:

```
R2_ACCOUNT_ID=<account id>
R2_ACCESS_KEY_ID=<access key id>
R2_SECRET_ACCESS_KEY=<secret access key>
R2_BUCKET=vault-artifacts
# R2_ENDPOINT=                           # optional; derived from account id by default
VAULT_INLINE_MAX_BYTES=5242880           # 5 MB; files above this go to storage
VAULT_SIGNED_URL_TTL_SECONDS=600         # signed URL lifetime
```

If the three `R2_*` credentials are blank, storage is disabled and the presign
endpoints return `503` (everything else works as before, inline-only).

## 3. Verify

With the backend running and the bucket created:

```
cd apps/backend-api
node scripts/verify-storage.cjs            # or: node scripts/verify-storage.cjs <API_BASE_URL>
```

It exercises the real round trip: presign upload → PUT straight to R2 → presign
download → GET → byte-compare, plus cross-owner isolation. All checks should print `PASS`.

If `presign upload` returns 503, the env vars aren't set. If the direct PUT fails with
`403 SignatureDoesNotMatch`, confirm the API token has write access to this bucket.

---

## Bundling modes (owner Host Engine)

- **Choose file(s)** — single-file apps or a few siblings. Each file ≤ 5 MB is inlined;
  larger ones upload to R2 individually. All land flat in `bin/`.
- **Choose a folder** — multi-file apps with subfolders. The whole tree is zipped
  (preserving structure), encrypted, and uploaded to R2 as **one** archive object. The
  user downloads it, verifies the checksum, decrypts, and unzips it into `app/` in the
  sandbox (zip-slip safe). The main executable is a relative path inside that tree.

## Endpoints

| Method | Path | Auth | Purpose |
| :-- | :-- | :-- | :-- |
| POST | `/api/v1/owner/vault/artifacts/presign` | Owner desktop JWT | Signed URL to upload one encrypted artifact |
| POST | `/api/v1/owner/vault/artifacts/presign-download` | Desktop JWT (owner/user) | Signed URL to download an artifact owned by this identity |

Object keys are namespaced `"<ownerId>/<uuid>"`; download presign re-checks that the
requested key belongs to the caller's owner.
