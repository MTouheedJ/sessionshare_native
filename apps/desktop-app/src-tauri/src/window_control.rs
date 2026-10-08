//! Native window hardening for the Tauri frame: capture exclusion and a
//! guarded close flag so normal users cannot kill the confidential frame.
//! See docs/development_coding_instructions.md §2.

use std::sync::atomic::{AtomicBool, Ordering};

/// When false, the window's CloseRequested is vetoed. Defaults to true (login /
/// owner screens are freely closable); a live user session sets it false so the
/// confidential frame can't be killed until an authorised teardown restores it.
static CLOSE_ALLOWED: AtomicBool = AtomicBool::new(true);

pub fn allow_close(allowed: bool) {
    CLOSE_ALLOWED.store(allowed, Ordering::SeqCst);
}

pub fn close_allowed() -> bool {
    CLOSE_ALLOWED.load(Ordering::SeqCst)
}

#[cfg(windows)]
pub fn set_capture_protection(hwnd: isize, enabled: bool) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    let affinity = if enabled {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };
    // Rewrap the raw handle into our windows-crate HWND (ptr-compatible newtype).
    let handle = HWND(hwnd as *mut core::ffi::c_void);
    unsafe {
        SetWindowDisplayAffinity(handle, affinity)
            .map_err(|e| format!("SetWindowDisplayAffinity failed: {e}"))
    }
}

#[cfg(not(windows))]
pub fn set_capture_protection(_hwnd: isize, _enabled: bool) -> Result<(), String> {
    // No-op on non-Windows; capture protection is a Windows-only guarantee.
    Ok(())
}
