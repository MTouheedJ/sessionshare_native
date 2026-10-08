//! SessionShare desktop client: native integration for HWID, sandboxed target
//! execution, window hardening, and the `sessionshare://` deep link.

mod hwid;
mod sandbox;
mod window_control;

use std::process::Command;
use std::sync::Mutex;

use base64::Engine;
use serde::Deserialize;
use tauri::{Emitter, Manager, WindowEvent};

use sandbox::{Sandbox, SandboxInfo, SeedFile};

/// Event emitted to the frontend when a `sessionshare://` URL is opened.
const DEEP_LINK_EVENT: &str = "deep-link://redeem";

#[derive(Default)]
struct AppState {
    sandbox: Mutex<Option<Sandbox>>,
    /// Deep link passed on first launch, before the webview can listen. The
    /// frontend drains this once on mount to avoid a startup emit race.
    pending_deep_link: Mutex<Option<String>>,
}

#[derive(Deserialize)]
struct SeedFileArg {
    path: String,
    /// base64-encoded file contents.
    data: String,
}

#[derive(Deserialize)]
struct StartSandboxArgs {
    token_id: String,
    executable: String,
    args: Vec<String>,
    files: Vec<SeedFileArg>,
    #[serde(default)]
    capture_protection: bool,
}

#[tauri::command]
fn get_hwid() -> String {
    hwid::compute()
}

/// Returns and clears the deep link captured at first launch, if any.
#[tauri::command]
fn take_pending_deep_link(state: tauri::State<'_, AppState>) -> Option<String> {
    state.pending_deep_link.lock().unwrap().take()
}

/// Creates the isolated sandbox, seeds vault files, and launches the target app
/// bound to the sandbox directory. Enables the close guard on success.
#[tauri::command]
fn start_sandbox(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppState>,
    args: StartSandboxArgs,
) -> Result<SandboxInfo, String> {
    let engine = base64::engine::general_purpose::STANDARD;
    let mut seed = Vec::with_capacity(args.files.len());
    for file in &args.files {
        let data = engine
            .decode(file.data.as_bytes())
            .map_err(|e| format!("invalid base64 for {}: {e}", file.path))?;
        seed.push(SeedFile {
            rel_path: file.path.clone(),
            data,
        });
    }
    let files_written = seed.len();

    let mut sandbox = Sandbox::create(&args.token_id, &seed)?;
    let spawn_args = sandbox.expand_args(&args.args);

    let child = Command::new(&args.executable)
        .args(&spawn_args)
        .current_dir(&sandbox.dir)
        .spawn()
        .map_err(|e| format!("failed to launch target app: {e}"))?;
    sandbox.child = Some(child);

    let info = sandbox.info(files_written);

    // Harden the control frame once a session is live.
    window_control::allow_close(false);
    if args.capture_protection {
        if let Ok(hwnd) = window.hwnd() {
            let _ = window_control::set_capture_protection(hwnd.0 as isize, true);
        }
    }

    *state.sandbox.lock().unwrap() = Some(sandbox);
    Ok(info)
}

/// Toggles Windows capture exclusion on the control frame.
#[tauri::command]
fn set_capture_protection(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    window_control::set_capture_protection(hwnd.0 as isize, enabled)
}

/// Tears down the sandbox (kills target, shreds files). Used on terminate/revoke
/// and on sign-out. The frame stays open and returns to the login screen.
#[tauri::command]
fn cleanup_sandbox(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if let Some(mut sandbox) = state.sandbox.lock().unwrap().take() {
        sandbox.teardown();
    }
    // Session over: lift the close guard and capture protection on the frame.
    window_control::allow_close(true);
    if let Ok(hwnd) = window.hwnd() {
        let _ = window_control::set_capture_protection(hwnd.0 as isize, false);
    }
    Ok(())
}

/// Permits the next window close (authorised quit), then closes it.
#[tauri::command]
fn quit_app(window: tauri::WebviewWindow, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if let Some(mut sandbox) = state.sandbox.lock().unwrap().take() {
        sandbox.teardown();
    }
    window_control::allow_close(true);
    window.close().map_err(|e| e.to_string())
}

/// Extracts a `sessionshare://redeem?token=...` URL from CLI args, if present.
fn deep_link_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .find(|a| a.starts_with("sessionshare://"))
        .cloned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (e.g. from a deep link) forwards its URL here.
            if let Some(url) = deep_link_from_args(&argv) {
                let _ = app.emit(DEEP_LINK_EVENT, url);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_hwid,
            take_pending_deep_link,
            start_sandbox,
            set_capture_protection,
            cleanup_sandbox,
            quit_app,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                // Register the scheme at runtime for dev; installers handle it in prod.
                let _ = app.deep_link().register_all();
            }
            // Stash any deep link from the launch argv; the frontend drains it on
            // mount (emitting here would race the webview's listener registration).
            if let Some(url) = deep_link_from_args(&std::env::args().collect::<Vec<_>>()) {
                if let Some(state) = app.try_state::<AppState>() {
                    *state.pending_deep_link.lock().unwrap() = Some(url);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Veto close while a protected session is active.
                if !window_control::close_allowed() {
                    api.prevent_close();
                    let _ = window.emit("window://close-blocked", ());
                } else if let Some(state) = window.try_state::<AppState>() {
                    if let Some(mut sandbox) = state.sandbox.lock().unwrap().take() {
                        sandbox.teardown();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
