mod db;
mod models;
mod secrets;
mod ssh;
mod terminal_transport;
use db::Database;
use models::*;
use ssh::SessionManager;
use std::{path::PathBuf, sync::Arc};
use tauri::{Manager, State};

pub(crate) struct AppState {
    pub(crate) db: Database,
    sessions: Arc<SessionManager>,
    known_hosts: PathBuf,
    terminal_transport: terminal_transport::TerminalTransportInfo,
}

/// Apply platform compatibility settings before GTK, WebKit, or Tauri starts.
///
/// WebKitGTK's DMA-BUF renderer crashes on NVIDIA-backed Wayland sessions and
/// adds a visible per-keystroke echo delay on Wayland generally (measured
/// against the same build with the renderer disabled). Disable it on Wayland;
/// an explicit user value always wins.
pub fn prepare_runtime() {
    #[cfg(target_os = "linux")]
    {
        let session_type = std::env::var_os("XDG_SESSION_TYPE");
        let wayland_display = std::env::var_os("WAYLAND_DISPLAY");
        let user_override = std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER");

        if should_disable_dmabuf(
            session_type.as_deref(),
            wayland_display.as_deref(),
            user_override.as_deref(),
        ) {
            // SAFETY: this runs as the first operation in main, before Tauri
            // or any other application thread is created.
            unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
        }
    }
}

#[cfg(target_os = "linux")]
fn is_wayland_session(
    session_type: Option<&std::ffi::OsStr>,
    wayland_display: Option<&std::ffi::OsStr>,
) -> bool {
    session_type.is_some_and(|value| value.eq_ignore_ascii_case("wayland"))
        || wayland_display.is_some_and(|value| !value.is_empty())
}

#[cfg(target_os = "linux")]
fn should_disable_dmabuf(
    session_type: Option<&std::ffi::OsStr>,
    wayland_display: Option<&std::ffi::OsStr>,
    user_override: Option<&std::ffi::OsStr>,
) -> bool {
    is_wayland_session(session_type, wayland_display) && user_override.is_none()
}

/// Whether the platform reports real global window positions. Wayland does
/// not: window.screenX/screenY in the webview are frame-offset garbage and
/// drag coordinates are window-relative, so the frontend must not use them.
#[tauri::command]
fn window_positioning_reliable() -> bool {
    #[cfg(target_os = "linux")]
    {
        !is_wayland_session(
            std::env::var_os("XDG_SESSION_TYPE").as_deref(),
            std::env::var_os("WAYLAND_DISPLAY").as_deref(),
        )
    }
    #[cfg(not(target_os = "linux"))]
    true
}

#[tauri::command]
fn list_profiles(state: State<AppState>) -> Result<Vec<MachineProfile>, String> {
    state.db.profiles()
}
#[tauri::command]
fn save_profile(state: State<AppState>, draft: MachineDraft) -> Result<MachineProfile, String> {
    validate(&draft)?;
    let id = draft
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let has_saved_password =
        store_secret(&id, "password", draft.save_password, draft.password.as_deref())?;
    let has_saved_passphrase = store_secret(
        &id,
        "passphrase",
        draft.save_passphrase,
        draft.passphrase.as_deref(),
    )?;
    let mut draft = draft;
    draft.id = Some(id);
    state
        .db
        .save_profile(&draft, has_saved_password, has_saved_passphrase)
}

/// Store or clear one secret and report whether the vault actually holds a
/// value afterwards — the profile's has_saved_* flag must reflect the vault,
/// not the checkbox (saving with the checkbox on but no secret entered must
/// not claim a credential exists).
fn store_secret(id: &str, kind: &str, save: bool, value: Option<&str>) -> Result<bool, String> {
    if !save {
        secrets::delete(id, kind);
        return Ok(false);
    }
    match value {
        Some(value) if !value.is_empty() => {
            secrets::set(id, kind, value)?;
            Ok(true)
        }
        _ => Ok(secrets::get(id, kind).is_some()),
    }
}
#[tauri::command]
fn delete_profile(state: State<AppState>, id: String) -> Result<(), String> {
    secrets::delete(&id, "password");
    secrets::delete(&id, "passphrase");
    state.db.delete_profile(&id)
}
#[tauri::command]
fn list_themes(state: State<AppState>) -> Result<Vec<ThemeDefinition>, String> {
    state.db.themes()
}
#[tauri::command]
fn save_theme(
    state: State<AppState>,
    mut theme: ThemeDefinition,
) -> Result<ThemeDefinition, String> {
    if theme.schema_version != 1 {
        return Err("Unsupported theme schema".into());
    }
    theme.built_in = false;
    state.db.save_theme(&theme)?;
    Ok(theme)
}
#[tauri::command]
fn delete_theme(state: State<AppState>, id: String) -> Result<(), String> {
    state.db.delete_theme(&id)
}
#[tauri::command]
fn get_app_settings(state: State<AppState>) -> Result<AppSettings, String> {
    state.db.settings()
}
#[tauri::command]
fn save_app_settings(state: State<AppState>, settings: AppSettings) -> Result<AppSettings, String> {
    validate_settings(&settings)?;
    state.db.save_settings(&settings)?;
    Ok(settings)
}
#[tauri::command]
fn connect_session(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<AppState>,
    request: ConnectRequest,
) -> Result<SessionSummary, String> {
    let profile = state
        .db
        .profile(&request.profile_id)?
        .ok_or("Machine not found")?;
    let password = request
        .password
        .or_else(|| secrets::get(&profile.id, "password"));
    let passphrase = request
        .passphrase
        .or_else(|| secrets::get(&profile.id, "passphrase"));
    let settings = state.db.settings()?;
    state.sessions.connect(
        app,
        window.label().to_string(),
        profile,
        password,
        passphrase,
        state.known_hosts.clone(),
        settings,
    )
}

fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    if settings.schema_version != 1 {
        return Err("Unsupported settings schema".into());
    }
    if settings.default_port == 0 {
        return Err("Default port must be between 1 and 65535".into());
    }
    if settings.terminal_type.is_empty()
        || settings.terminal_type.len() > 64
        || !settings
            .terminal_type
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._+".contains(c))
    {
        return Err("Terminal type contains unsupported characters".into());
    }
    if !(5..=300).contains(&settings.keepalive_interval_seconds) {
        return Err("Keepalive interval must be between 5 and 300 seconds".into());
    }
    if !(30..=3600).contains(&settings.inactivity_timeout_seconds) {
        return Err("Inactivity timeout must be between 30 and 3600 seconds".into());
    }
    Ok(())
}
#[tauri::command]
fn terminal_transport_info(state: State<AppState>) -> terminal_transport::TerminalTransportInfo {
    state.terminal_transport.clone()
}
#[tauri::command]
fn disconnect_session(state: State<AppState>, session_id: String) -> Result<(), String> {
    state.sessions.disconnect(&session_id)
}
#[tauri::command]
fn approve_host_key(
    state: State<AppState>,
    session_id: String,
    approve: bool,
) -> Result<(), String> {
    state.sessions.approve(&session_id, approve)
}

fn validate(d: &MachineDraft) -> Result<(), String> {
    if d.name.trim().is_empty() {
        return Err("Display name is required".into());
    }
    if d.host.trim().is_empty() || d.host.chars().any(char::is_whitespace) {
        return Err("Invalid hostname".into());
    }
    if d.username.trim().is_empty() || d.username.chars().any(char::is_whitespace) {
        return Err("Invalid username".into());
    }
    if d.auth_kind == AuthKind::PrivateKey
        && d.private_key_path
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        return Err("Private key path is required".into());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let sessions = Arc::new(SessionManager::default());
            let terminal_transport =
                tauri::async_runtime::block_on(terminal_transport::start(sessions.clone()))
                    .map_err(std::io::Error::other)?;
            let state = AppState {
                db: Database::open(&data.join("sesh.sqlite3")).map_err(std::io::Error::other)?,
                sessions,
                known_hosts: data.join("known_hosts"),
                terminal_transport,
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            save_profile,
            delete_profile,
            list_themes,
            save_theme,
            delete_theme,
            get_app_settings,
            save_app_settings,
            connect_session,
            terminal_transport_info,
            window_positioning_reliable,
            disconnect_session,
            approve_host_key
        ])
        .run(tauri::generate_context!())
        .expect("failed to run sesh")
}

#[cfg(all(test, target_os = "linux"))]
mod runtime_tests {
    use super::should_disable_dmabuf;
    use std::ffi::OsStr;

    #[test]
    fn disables_dmabuf_on_wayland() {
        assert!(should_disable_dmabuf(
            Some(OsStr::new("wayland")),
            Some(OsStr::new("wayland-0")),
            None
        ));
    }

    #[test]
    fn disables_dmabuf_when_only_the_wayland_display_is_set() {
        assert!(should_disable_dmabuf(
            None,
            Some(OsStr::new("wayland-0")),
            None
        ));
    }

    #[test]
    fn leaves_x11_unchanged() {
        assert!(!should_disable_dmabuf(Some(OsStr::new("x11")), None, None));
    }

    #[test]
    fn respects_an_explicit_user_override() {
        assert!(!should_disable_dmabuf(
            Some(OsStr::new("wayland")),
            Some(OsStr::new("wayland-0")),
            Some(OsStr::new("0"))
        ));
    }
}

#[cfg(test)]
mod settings_tests {
    use super::validate_settings;
    use crate::models::AppSettings;

    #[test]
    fn default_application_settings_are_valid() {
        assert!(validate_settings(&AppSettings::default()).is_ok());
    }

    #[test]
    fn unsafe_terminal_types_are_rejected() {
        let mut settings = AppSettings::default();
        settings.terminal_type = "xterm; reboot".into();
        assert!(validate_settings(&settings).is_err());
    }
}
