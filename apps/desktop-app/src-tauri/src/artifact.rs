//! Client-side packaging for large (object-backed) vault artifacts.
//!
//! Owner side: encrypt a file with a fresh AES-256-GCM key and PUT the ciphertext
//! straight to object storage via a signed URL — the bytes never touch the backend.
//! User side: download the ciphertext from a signed URL, verify its SHA-256, and
//! decrypt it with the key carried in the (separately encrypted) vault metadata.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

/// Result of zipping an app folder into a temporary archive.
#[derive(Serialize)]
pub struct ArchiveResult {
    /// Absolute path to the temp .zip on disk (uploaded, then deleted by the caller).
    pub zip_path: String,
    /// Size of the .zip in bytes.
    pub size: u64,
    /// Relative file entries inside the archive (forward-slashed), for picking the main exe.
    pub entries: Vec<String>,
}

/// Zips an entire directory tree into a temp .zip, preserving relative structure.
/// Supports both single-file apps (a one-entry zip) and multi-file apps with
/// sibling files and subfolders. Returns the temp path, size, and entry list.
pub fn zip_dir(src_dir: &str) -> Result<ArchiveResult, String> {
    let src = Path::new(src_dir);
    if !src.is_dir() {
        return Err(format!("not a directory: {src_dir}"));
    }
    let mut files: Vec<PathBuf> = Vec::new();
    collect_files(src, &mut files)?;
    if files.is_empty() {
        return Err("the selected folder is empty".into());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut out_path = std::env::temp_dir();
    out_path.push(format!("sessionshare_pack_{stamp}.zip"));

    let file = fs::File::create(&out_path).map_err(|e| format!("create zip: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let mut entries = Vec::with_capacity(files.len());
    for path in &files {
        let rel = path
            .strip_prefix(src)
            .map_err(|e| format!("relativize: {e}"))?
            .to_string_lossy()
            .replace('\\', "/");
        zip.start_file(&rel, options)
            .map_err(|e| format!("zip entry {rel}: {e}"))?;
        let mut f =
            fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        zip.write_all(&buf)
            .map_err(|e| format!("write entry {rel}: {e}"))?;
        entries.push(rel);
    }
    zip.finish().map_err(|e| format!("finish zip: {e}"))?;

    let size = fs::metadata(&out_path)
        .map_err(|e| format!("stat zip: {e}"))?
        .len();
    Ok(ArchiveResult {
        zip_path: out_path.to_string_lossy().to_string(),
        size,
        entries,
    })
}

/// Recursively collects regular files (symlinks skipped) under `dir`.
fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("read dir {}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| format!("dir entry: {e}"))?;
        let ft = entry.file_type().map_err(|e| format!("file type: {e}"))?;
        let path = entry.path();
        if ft.is_dir() {
            collect_files(&path, out)?;
        } else if ft.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct ArtifactMeta {
    /// base64 AES-256 key.
    pub key: String,
    /// base64 96-bit nonce.
    pub nonce: String,
    /// hex SHA-256 of the plaintext (integrity check on download).
    pub sha256: String,
    /// plaintext size in bytes.
    pub size: u64,
}

fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Reads, encrypts, and uploads a file to a signed storage URL. Returns the
/// metadata needed to fetch and decrypt it later.
pub async fn encrypt_and_upload(file_path: &str, upload_url: &str) -> Result<ArtifactMeta, String> {
    let plaintext = std::fs::read(file_path).map_err(|e| format!("read {file_path}: {e}"))?;
    let size = plaintext.len() as u64;
    let sha256 = sha256_hex(&plaintext);

    let mut key = [0u8; KEY_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut key);
    rand::rngs::OsRng.fill_bytes(&mut nonce);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_ref())
        .map_err(|_| "encryption failed".to_string())?;

    let resp = reqwest::Client::new()
        .put(upload_url)
        .header("content-type", "application/octet-stream")
        .body(ciphertext)
        .send()
        .await
        .map_err(|e| format!("upload request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("upload failed: HTTP {}", resp.status()));
    }

    Ok(ArtifactMeta {
        key: b64().encode(key),
        nonce: b64().encode(nonce),
        sha256,
        size,
    })
}

/// Downloads ciphertext from a signed URL, verifies integrity, and decrypts it.
pub async fn download_and_decrypt(
    download_url: &str,
    key_b64: &str,
    nonce_b64: &str,
    sha256_hex_expected: &str,
) -> Result<Vec<u8>, String> {
    let key = b64()
        .decode(key_b64)
        .map_err(|e| format!("bad key: {e}"))?;
    let nonce = b64()
        .decode(nonce_b64)
        .map_err(|e| format!("bad nonce: {e}"))?;
    if key.len() != KEY_LEN || nonce.len() != NONCE_LEN {
        return Err("invalid key/nonce length".into());
    }

    let resp = reqwest::get(download_url)
        .await
        .map_err(|e| format!("download request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let ciphertext = resp
        .bytes()
        .await
        .map_err(|e| format!("download body failed: {e}"))?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| "decryption failed (wrong key or corrupted data)".to_string())?;

    if sha256_hex(&plaintext) != sha256_hex_expected {
        return Err("integrity check failed: checksum mismatch".into());
    }
    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip_in_memory() {
        // Exercises the crypto path without network I/O.
        let plaintext = b"portable app binary bytes".to_vec();
        let sha = sha256_hex(&plaintext);
        let mut key = [0u8; KEY_LEN];
        let mut nonce = [0u8; NONCE_LEN];
        rand::rngs::OsRng.fill_bytes(&mut key);
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        let ct = cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext.as_ref())
            .unwrap();
        assert_ne!(ct, plaintext);
        let pt = cipher
            .decrypt(Nonce::from_slice(&nonce), ct.as_ref())
            .unwrap();
        assert_eq!(pt, plaintext);
        assert_eq!(sha256_hex(&pt), sha);
        // Tampered ciphertext must fail authentication.
        let mut bad = ct.clone();
        bad[0] ^= 0xff;
        assert!(cipher.decrypt(Nonce::from_slice(&nonce), bad.as_ref()).is_err());
    }
}
