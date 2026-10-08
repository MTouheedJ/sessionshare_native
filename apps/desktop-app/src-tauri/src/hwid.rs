//! Deterministic hardware identifier for single-device token binding.
//!
//! The spec (docs/security_and_isolation_specifications.md) defines
//! `HWID = SHA256(CPU_ID + MOTHERBOARD_SERIAL + MAC_ADDR)`. We approximate that
//! with stable per-machine identifiers that do not require WMI: the Windows
//! `MachineGuid`, the BIOS/baseboard identifiers from the registry, and the
//! computer name. The result is a lowercase hex SHA-256, 64 chars, matching the
//! format the backend validates.

use sha2::{Digest, Sha256};

#[cfg(windows)]
fn reg_sz(subkey: &str, value: &str) -> Option<String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{ERROR_SUCCESS, MAX_PATH};
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
    };

    let subkey = HSTRING::from(subkey);
    let value = HSTRING::from(value);
    // Registry strings are UTF-16; MAX_PATH*2 wide chars is ample for these values.
    let mut buf = vec![0u16; (MAX_PATH as usize) * 2];
    let mut size = (buf.len() * std::mem::size_of::<u16>()) as u32;

    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(subkey.as_ptr()),
            PCWSTR(value.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut _),
            Some(&mut size),
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    // `size` counts bytes including the trailing NUL.
    let chars = (size as usize / std::mem::size_of::<u16>()).saturating_sub(1);
    Some(String::from_utf16_lossy(&buf[..chars]))
}

#[cfg(windows)]
fn collect_components() -> Vec<String> {
    let mut parts = Vec::new();
    if let Some(v) = reg_sz(r"SOFTWARE\Microsoft\Cryptography", "MachineGuid") {
        parts.push(v);
    }
    let bios = r"HARDWARE\DESCRIPTION\System\BIOS";
    for value in ["SystemManufacturer", "SystemProductName", "BaseBoardProduct"] {
        if let Some(v) = reg_sz(bios, value) {
            parts.push(v);
        }
    }
    if let Ok(name) = std::env::var("COMPUTERNAME") {
        parts.push(name);
    }
    parts
}

#[cfg(not(windows))]
fn collect_components() -> Vec<String> {
    // Non-Windows fallback so the app still builds and runs in dev on other hosts.
    let mut parts = Vec::new();
    if let Ok(id) = std::fs::read_to_string("/etc/machine-id") {
        parts.push(id.trim().to_string());
    }
    if let Ok(name) = std::env::var("HOSTNAME") {
        parts.push(name);
    }
    parts
}

/// Returns the lowercase hex SHA-256 HWID for this machine.
pub fn compute() -> String {
    let components = collect_components();
    // Guarantee a non-empty, deterministic seed even if every probe fails.
    let seed = if components.is_empty() {
        std::env::var("USERNAME").unwrap_or_else(|_| "sessionshare-unknown-host".into())
    } else {
        components.join("|")
    };

    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::compute;

    #[test]
    fn hwid_is_64_lowercase_hex_and_stable() {
        let a = compute();
        let b = compute();
        assert_eq!(a, b, "HWID must be deterministic across calls");
        assert_eq!(a.len(), 64, "HWID must be a SHA-256 hex string");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }
}
