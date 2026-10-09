/*
 * Phase-1 verification for object-storage bundling.
 *
 * Proves the full direct-to-storage round trip against YOUR real Supabase project:
 *   register owner -> owner token -> desktop JWT -> presign upload
 *   -> PUT bytes straight to Supabase Storage -> presign download -> GET -> compare.
 *
 * Prereqs:
 *   1. Backend running with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set (see .env.example).
 *   2. A Storage bucket matching SUPABASE_STORAGE_BUCKET (default "vault-artifacts").
 *
 * Usage:
 *   node scripts/verify-storage.cjs [API_BASE_URL]
 *   (default API_BASE_URL = http://localhost:3000/api/v1)
 */
const crypto = require("node:crypto");

const BASE = (process.argv[2] || "http://localhost:3000/api/v1").replace(/\/$/, "");
const HWID = "a".repeat(64);

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};

(async () => {
  const email = `storage${Date.now()}@test.dev`;
  const reg = await api("POST", "/auth/register", { email, password: "correct-horse-battery" });
  if (reg.status >= 300) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  const jwt = reg.body.accessToken;

  const owner = (await api("POST", "/owner/tokens", { name: "Storage Test" }, jwt)).body;
  const ov = await api("POST", "/tokens/validate", { token: owner.token, hwid: HWID });
  const desktopJwt = ov.body.accessToken;

  // 1. presign upload
  const presign = await api("POST", "/owner/vault/artifacts/presign", undefined, desktopJwt);
  check(
    "presign upload returns a signed URL",
    presign.status === 200 && typeof presign.body?.uploadUrl === "string",
    presign.status === 200 ? presign.body.objectKey : JSON.stringify(presign.body),
  );
  if (presign.status !== 200) {
    console.log("\nHINT: 503 = SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set on the backend.");
    process.exit(1);
  }
  const { objectKey, uploadUrl, method } = presign.body;

  // 2. upload random bytes directly to storage (simulates encrypted ciphertext)
  const payload = crypto.randomBytes(3 * 1024 * 1024); // 3 MB
  const sha = crypto.createHash("sha256").update(payload).digest("hex");
  const put = await fetch(uploadUrl, {
    method,
    headers: { "Content-Type": "application/octet-stream" },
    body: payload,
  });
  check("direct upload to Supabase Storage", put.ok, `HTTP ${put.status}`);
  if (!put.ok) {
    console.log("  response:", (await put.text()).slice(0, 300));
  }

  // 3. presign download + fetch + compare
  const dl = await api(
    "POST",
    "/owner/vault/artifacts/presign-download",
    { objectKey },
    desktopJwt,
  );
  check("presign download returns a signed URL", dl.status === 200 && !!dl.body?.url);
  if (dl.status === 200) {
    const got = Buffer.from(await (await fetch(dl.body.url)).arrayBuffer());
    const gotSha = crypto.createHash("sha256").update(got).digest("hex");
    check("downloaded bytes are byte-identical", gotSha === sha, `${got.length} bytes`);
  }

  // 4. cross-owner isolation
  const other = (await api("POST", "/auth/register", { email: `x${email}`, password: "correct-horse-battery" })).body
    .accessToken;
  const ot2 = (await api("POST", "/owner/tokens", { name: "Other" }, other)).body;
  const ov2 = await api("POST", "/tokens/validate", { token: ot2.token, hwid: "b".repeat(64) });
  const foreign = await api(
    "POST",
    "/owner/vault/artifacts/presign-download",
    { objectKey },
    ov2.body.accessToken,
  );
  check("another owner cannot get a download URL for this object", foreign.status === 403);

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
