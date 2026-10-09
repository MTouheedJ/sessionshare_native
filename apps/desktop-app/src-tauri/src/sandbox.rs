//! Isolated per-session sandbox: a temporary profile directory seeded with the
//! owner's decrypted vault files, used as the data directory for the target app.
//!
//! On teardown the directory is overwritten then removed ("shred"), and the
//! spawned target process is killed. See docs/security_and_isolation_specifications.md §3.

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Child;

use serde::Serialize;

/// A seed file to materialise inside the sandbox, as delivered in the vault payload.
pub struct SeedFile {
    /// Sandbox-relative path (already validated server-side; re-checked here).
    pub rel_path: String,
    /// Raw bytes to write.
    pub data: Vec<u8>,
}

#[derive(Serialize, Clone)]
pub struct SandboxInfo {
    pub token_id: String,
    pub dir: String,
    pub files_written: usize,
    pub pid: Option<u32>,
}

/// Owns the sandbox directory and (optionally) the running target process.
pub struct Sandbox {
    pub token_id: String,
    pub dir: PathBuf,
    pub child: Option<Child>,
}

/// Rejects absolute paths, drive letters, and any `..` traversal.
fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let candidate = Path::new(rel);
    if candidate.is_absolute() {
        return None;
    }
    let mut out = root.to_path_buf();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => out.push(part),
            // Reject `..`, `.`, root, and `C:` prefixes outright.
            _ => return None,
        }
    }
    Some(out)
}

impl Sandbox {
    fn root_for(token_id: &str) -> PathBuf {
        let mut base = std::env::temp_dir();
        base.push(format!("SessionShare_Sandbox_{token_id}"));
        base
    }

    /// Creates a fresh sandbox directory (removing any stale one) and writes seed files.
    pub fn create(token_id: &str, files: &[SeedFile]) -> Result<Self, String> {
        let dir = Self::root_for(token_id);
        if dir.exists() {
            shred_dir(&dir);
        }
        fs::create_dir_all(&dir).map_err(|e| format!("create sandbox: {e}"))?;

        for file in files {
            let target = safe_join(&dir, &file.rel_path)
                .ok_or_else(|| format!("unsafe sandbox path: {}", file.rel_path))?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
            }
            let mut f = fs::File::create(&target).map_err(|e| format!("write seed: {e}"))?;
            f.write_all(&file.data).map_err(|e| format!("write seed: {e}"))?;
        }

        Ok(Self {
            token_id: token_id.to_string(),
            dir,
            child: None,
        })
    }

    /// Writes one file into the sandbox at a safe relative path (used for
    /// object-backed artifacts decrypted at redemption time).
    pub fn write_file(&self, rel_path: &str, data: &[u8]) -> Result<(), String> {
        let target = safe_join(&self.dir, rel_path)
            .ok_or_else(|| format!("unsafe sandbox path: {rel_path}"))?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
        }
        fs::write(&target, data).map_err(|e| format!("write {rel_path}: {e}"))
    }

    /// Replaces `{sandbox}` in each argument with the sandbox directory path.
    pub fn expand_args(&self, args: &[String]) -> Vec<String> {
        let dir = self.dir.to_string_lossy().to_string();
        args.iter().map(|a| a.replace("{sandbox}", &dir)).collect()
    }

    /// Resolves the executable to an absolute path. Absolute inputs (apps already
    /// installed on the client) are used as-is; a relative input is resolved
    /// inside the sandbox (zero-install bundled binary), rejecting `..` traversal.
    ///
    /// Note: a relative program path MUST be made absolute here — Windows
    /// CreateProcess resolves a relative program name against the *parent's* cwd,
    /// not the child's `current_dir`, so `current_dir(sandbox)` is not enough.
    pub fn resolve_executable(&self, exe: &str) -> Result<PathBuf, String> {
        let candidate = Path::new(exe);
        if candidate.is_absolute() {
            return Ok(candidate.to_path_buf());
        }
        let resolved =
            safe_join(&self.dir, exe).ok_or_else(|| format!("unsafe executable path: {exe}"))?;
        if !resolved.exists() {
            return Err(format!("bundled executable not found in sandbox: {exe}"));
        }
        Ok(resolved)
    }

    pub fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(Child::id)
    }

    pub fn info(&self, files_written: usize) -> SandboxInfo {
        SandboxInfo {
            token_id: self.token_id.clone(),
            dir: self.dir.to_string_lossy().to_string(),
            files_written,
            pid: self.pid(),
        }
    }

    /// Kills the target process and securely removes the sandbox directory.
    pub fn teardown(&mut self) {
        if let Some(mut child) = self.child.take() {
            kill_process_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
        shred_dir(&self.dir);
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        self.teardown();
    }
}

/// Best-effort secure delete: overwrite regular files with zeros, then recurse-remove.
fn shred_dir(dir: &Path) {
    if !dir.exists() {
        return;
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(ft) if ft.is_dir() => shred_dir(&path),
                Ok(_) => overwrite_file(&path),
                Err(_) => {}
            }
        }
    }
    let _ = fs::remove_dir_all(dir);
}

fn overwrite_file(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        if let Ok(mut f) = fs::OpenOptions::new().write(true).open(path) {
            let zeros = vec![0u8; 8192];
            let mut remaining = meta.len();
            while remaining > 0 {
                let n = remaining.min(zeros.len() as u64) as usize;
                if f.write_all(&zeros[..n]).is_err() {
                    break;
                }
                remaining -= n as u64;
            }
            let _ = f.flush();
        }
    }
    let _ = fs::remove_file(path);
}

#[cfg(windows)]
fn kill_process_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // /T kills the whole tree, /F forces it. Best-effort; errors ignored.
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[cfg(not(windows))]
fn kill_process_tree(_pid: u32) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn safe_join_accepts_nested_relative_paths() {
        let root = Path::new("/tmp/sb");
        let joined = safe_join(root, "Cookies/data.sqlite").unwrap();
        assert!(joined.ends_with("Cookies/data.sqlite") || joined.ends_with("Cookies\\data.sqlite"));
    }

    #[test]
    fn safe_join_rejects_traversal_and_absolute() {
        let root = Path::new("/tmp/sb");
        assert!(safe_join(root, "../evil").is_none());
        assert!(safe_join(root, "a/../../evil").is_none());
        assert!(safe_join(root, "/etc/passwd").is_none());
        #[cfg(windows)]
        assert!(safe_join(root, r"C:\Windows\x").is_none());
    }

    #[test]
    fn create_seeds_files_and_teardown_removes_dir() {
        let token = format!("test_{}", std::process::id());
        let files = vec![SeedFile {
            rel_path: "profile/creds.bin".into(),
            data: b"secret".to_vec(),
        }];
        let mut sb = Sandbox::create(&token, &files).unwrap();
        let seeded = sb.dir.join("profile").join("creds.bin");
        assert!(seeded.exists());
        assert_eq!(fs::read(&seeded).unwrap(), b"secret");

        let dir = sb.dir.clone();
        sb.teardown();
        assert!(!dir.exists(), "sandbox dir should be shredded");
    }

    #[test]
    fn resolve_executable_handles_absolute_relative_and_traversal() {
        let token = format!("exetest_{}", std::process::id());
        let files = vec![SeedFile {
            rel_path: "bin/app.exe".into(),
            data: b"MZ".to_vec(),
        }];
        let mut sb = Sandbox::create(&token, &files).unwrap();

        // Relative bundled path resolves inside the sandbox.
        let resolved = sb.resolve_executable("bin/app.exe").unwrap();
        assert!(resolved.starts_with(&sb.dir));
        assert!(resolved.ends_with("app.exe"));

        // Absolute path is returned unchanged (installed-app case).
        #[cfg(windows)]
        {
            let abs = r"C:\Windows\System32\notepad.exe";
            assert_eq!(sb.resolve_executable(abs).unwrap().to_string_lossy(), abs);
        }

        // Traversal and missing bundled files are rejected.
        assert!(sb.resolve_executable("../evil.exe").is_err());
        assert!(sb.resolve_executable("bin/missing.exe").is_err());

        sb.teardown();
    }

    #[test]
    fn expand_args_substitutes_sandbox_token() {
        let sb = Sandbox {
            token_id: "t".into(),
            dir: PathBuf::from("/tmp/x"),
            child: None,
        };
        let out = sb.expand_args(&["--data={sandbox}".into(), "--flag".into()]);
        assert_eq!(out, vec!["--data=/tmp/x".to_string(), "--flag".to_string()]);
    }
}
