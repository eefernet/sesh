use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_kind: AuthKind,
    pub private_key_path: Option<String>,
    pub has_saved_password: bool,
    pub has_saved_passphrase: bool,
    pub theme_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_connected_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AuthKind {
    Password,
    PrivateKey,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineDraft {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_kind: AuthKind,
    pub private_key_path: Option<String>,
    pub password: Option<String>,
    pub passphrase: Option<String>,
    pub save_password: bool,
    pub save_passphrase: bool,
    pub theme_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeDefinition {
    pub schema_version: u8,
    pub id: String,
    pub name: String,
    pub built_in: bool,
    #[serde(flatten)]
    pub settings: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u8,
    pub global_theme_id: String,
    pub confirm_close_sessions: bool,
    pub focus_new_sessions: bool,
    pub default_port: u16,
    pub terminal_type: String,
    pub keepalive_interval_seconds: u64,
    pub inactivity_timeout_seconds: u64,
    pub terminal_renderer: TerminalRenderer,
    pub frontend_latency_tracing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalRenderer {
    Auto,
    Canvas,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            global_theme_id: "sesh-midnight".into(),
            confirm_close_sessions: true,
            focus_new_sessions: true,
            default_port: 22,
            terminal_type: "xterm-256color".into(),
            keepalive_interval_seconds: 20,
            inactivity_timeout_seconds: 60,
            terminal_renderer: TerminalRenderer::Auto,
            frontend_latency_tracing: false,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    pub profile_id: String,
    pub password: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub profile_id: String,
    pub profile_name: String,
    pub status: SessionStatus,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Connecting,
    VerifyingHost,
    Authenticating,
    Connected,
    Disconnected,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOutput {
    pub session_id: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyChallenge {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    pub kind: String,
    pub window_label: String,
}
