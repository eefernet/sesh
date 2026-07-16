use crate::models::{
    AppSettings, AuthKind, HostKeyChallenge, MachineProfile, SessionOutput, SessionStatus,
    SessionSummary,
};
use crate::terminal_transport::trace_latency;
use russh::{
    ChannelMsg, Disconnect, client,
    keys::{self, PrivateKeyWithHashAlg, ssh_key},
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast;
use tokio::sync::{mpsc, oneshot};

enum Control {
    Input(Vec<u8>),
    Resize(u32, u32),
    Disconnect,
}

type SessionMap = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Control>>>>;
type ApprovalMap = Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>;

/// Removes a session's control channel and any pending host-key approval when
/// the session task ends — naturally, by error, or by panic. Without this the
/// maps only shrink on explicit disconnect and grow for the app's lifetime.
struct SessionCleanup {
    id: String,
    sessions: SessionMap,
    approvals: ApprovalMap,
}
impl Drop for SessionCleanup {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(&self.id);
        }
        if let Ok(mut approvals) = self.approvals.lock() {
            approvals.remove(&self.id);
        }
    }
}

pub struct SessionManager {
    sessions: SessionMap,
    approvals: ApprovalMap,
    output: broadcast::Sender<SessionOutput>,
}

impl Default for SessionManager {
    fn default() -> Self {
        // Sized for output bursts (e.g. cat-ing a large file) so a briefly
        // slow webview does not force the transport to drop frames.
        let (output, _) = broadcast::channel(8192);
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            approvals: Arc::new(Mutex::new(HashMap::new())),
            output,
        }
    }
}

impl SessionManager {
    pub fn connect(
        &self,
        app: AppHandle,
        origin_label: String,
        profile: MachineProfile,
        password: Option<String>,
        passphrase: Option<String>,
        known_hosts: PathBuf,
        settings: AppSettings,
    ) -> Result<SessionSummary, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::unbounded_channel();
        self.sessions
            .lock()
            .map_err(|_| "Session lock failed")?
            .insert(id.clone(), tx);
        let summary = SessionSummary {
            id: id.clone(),
            profile_id: profile.id.clone(),
            profile_name: profile.name.clone(),
            status: SessionStatus::Connecting,
            last_error: None,
        };
        let approvals = self.approvals.clone();
        let sid = id.clone();
        let pid = profile.id.clone();
        let pname = profile.name.clone();
        let output = self.output.clone();
        let cleanup = SessionCleanup {
            id: id.clone(),
            sessions: self.sessions.clone(),
            approvals: self.approvals.clone(),
        };
        tauri::async_runtime::spawn(async move {
            let _cleanup = cleanup;
            if let Err(error) = run_session(
                app.clone(),
                sid.clone(),
                origin_label,
                profile,
                password,
                passphrase,
                known_hosts,
                approvals,
                output,
                settings,
                rx,
            )
            .await
            {
                emit_status(
                    &app,
                    &sid,
                    &pid,
                    &pname,
                    SessionStatus::Failed,
                    Some(user_error(&error)),
                );
            }
        });
        Ok(summary)
    }
    pub fn subscribe_output(&self) -> broadcast::Receiver<SessionOutput> {
        self.output.subscribe()
    }
    pub fn input(&self, id: &str, data: Vec<u8>) -> Result<(), String> {
        self.send(id, Control::Input(data))
    }
    pub fn resize(&self, id: &str, cols: u32, rows: u32) -> Result<(), String> {
        self.send(id, Control::Resize(cols, rows))
    }
    pub fn disconnect(&self, id: &str) -> Result<(), String> {
        let result = self.send(id, Control::Disconnect);
        self.sessions
            .lock()
            .map_err(|_| "Session lock failed")?
            .remove(id);
        result
    }
    pub fn approve(&self, id: &str, approve: bool) -> Result<(), String> {
        self.approvals
            .lock()
            .map_err(|_| "Approval lock failed")?
            .remove(id)
            .ok_or_else(|| "Host-key request expired".to_string())?
            .send(approve)
            .map_err(|_| "Connection is no longer waiting for approval".into())
    }
    fn send(&self, id: &str, msg: Control) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|_| "Session lock failed")?
            .get(id)
            .ok_or_else(|| "Session not found".to_string())?
            .send(msg)
            .map_err(|_| "Session is no longer running".into())
    }
}

struct HostVerifier {
    app: AppHandle,
    session_id: String,
    origin_label: String,
    host: String,
    port: u16,
    path: PathBuf,
    approvals: ApprovalMap,
}
impl client::Handler for HostVerifier {
    type Error = russh::Error;
    async fn check_server_key(&mut self, key: &ssh_key::PublicKey) -> Result<bool, Self::Error> {
        match keys::known_hosts::check_known_hosts_path(&self.host, self.port, key, &self.path) {
            Ok(true) => return Ok(true),
            Err(_) => {
                // A mismatched key (or an unreadable known_hosts file) is
                // rejected outright. This challenge is informational only: no
                // approval is awaited and approve_host_key will not find a
                // pending request. The user must fix known_hosts by hand
                // before reconnecting.
                let challenge = HostKeyChallenge {
                    session_id: self.session_id.clone(),
                    host: self.host.clone(),
                    port: self.port,
                    algorithm: key.algorithm().to_string(),
                    fingerprint: key.fingerprint(ssh_key::HashAlg::Sha256).to_string(),
                    kind: "changed".into(),
                    window_label: self.origin_label.clone(),
                };
                let _ = self.app.emit("host-key-challenge", challenge);
                return Ok(false);
            }
            Ok(false) => {}
        }
        let (tx, rx) = oneshot::channel();
        if let Ok(mut pending) = self.approvals.lock() {
            pending.insert(self.session_id.clone(), tx)
        } else {
            return Ok(false);
        };
        let challenge = HostKeyChallenge {
            session_id: self.session_id.clone(),
            host: self.host.clone(),
            port: self.port,
            algorithm: key.algorithm().to_string(),
            fingerprint: key.fingerprint(ssh_key::HashAlg::Sha256).to_string(),
            kind: "new".into(),
            window_label: self.origin_label.clone(),
        };
        let _ = self.app.emit("host-key-challenge", challenge);
        let accepted = tokio::time::timeout(Duration::from_secs(120), rx)
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or(false);
        // On timeout the sender is still in the map; drop it so stale
        // approvals do not accumulate. Idempotent when approve() already ran.
        if let Ok(mut pending) = self.approvals.lock() {
            pending.remove(&self.session_id);
        }
        if accepted {
            Ok(
                keys::known_hosts::learn_known_hosts_path(&self.host, self.port, key, &self.path)
                    .is_ok(),
            )
        } else {
            Ok(false)
        }
    }
}

async fn run_session(
    app: AppHandle,
    id: String,
    origin_label: String,
    profile: MachineProfile,
    password: Option<String>,
    passphrase: Option<String>,
    known_hosts: PathBuf,
    approvals: ApprovalMap,
    output: broadcast::Sender<SessionOutput>,
    settings: AppSettings,
    mut controls: mpsc::UnboundedReceiver<Control>,
) -> Result<(), String> {
    emit_status(
        &app,
        &id,
        &profile.id,
        &profile.name,
        SessionStatus::VerifyingHost,
        None,
    );
    let config = Arc::new(ssh_client_config(&settings));
    let verifier = HostVerifier {
        app: app.clone(),
        session_id: id.clone(),
        origin_label,
        host: profile.host.clone(),
        port: profile.port,
        path: known_hosts,
        approvals,
    };
    let mut connection = client::connect(config, (profile.host.as_str(), profile.port), verifier)
        .await
        .map_err(|e| format!("connect:{e}"))?;
    emit_status(
        &app,
        &id,
        &profile.id,
        &profile.name,
        SessionStatus::Authenticating,
        None,
    );
    let auth = match profile.auth_kind {
        AuthKind::Password => connection
            .authenticate_password(&profile.username, password.ok_or("auth:Password required")?)
            .await
            .map_err(|e| format!("auth:{e}"))?,
        AuthKind::PrivateKey => {
            let path = profile
                .private_key_path
                .as_ref()
                .ok_or("key:Private key path missing")?;
            let key = keys::load_secret_key(path, passphrase.as_deref())
                .map_err(|e| format!("key:{e}"))?;
            let hash = connection
                .best_supported_rsa_hash()
                .await
                .map_err(|e| format!("auth:{e}"))?
                .flatten();
            connection
                .authenticate_publickey(
                    &profile.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await
                .map_err(|e| format!("auth:{e}"))?
        }
    };
    if !auth.success() {
        return Err("auth:Authentication rejected by the server".into());
    }
    let mut channel = connection
        .channel_open_session()
        .await
        .map_err(|e| format!("channel:{e}"))?;
    channel
        .request_pty(false, &settings.terminal_type, 120, 36, 0, 0, &[])
        .await
        .map_err(|e| format!("pty:{e}"))?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("shell:{e}"))?;
    emit_status(
        &app,
        &id,
        &profile.id,
        &profile.name,
        SessionStatus::Connected,
        None,
    );
    // Record last_connected_at only once the session actually reached
    // Connected; failed attempts must not reorder the dashboard.
    if let Some(state) = app.try_state::<crate::AppState>() {
        state.db.touch_profile(&profile.id);
    }
    loop {
        tokio::select! {
            control=controls.recv()=>match control {Some(Control::Input(data))=>{trace_latency("ssh-send",data.len());channel.data(&data[..]).await.map_err(|e|format!("write:{e}"))?;trace_latency("ssh-sent",data.len());},Some(Control::Resize(cols,rows))=>channel.window_change(cols,rows,0,0).await.map_err(|e|format!("resize:{e}"))?,Some(Control::Disconnect)|None=>{let _=channel.eof().await;let _=connection.disconnect(Disconnect::ByApplication,"Closed by user","en").await;break}},
            message=channel.wait()=>match message {Some(ChannelMsg::Data{data})|Some(ChannelMsg::ExtendedData{data,..})=>{trace_latency("ssh-out",data.len());let _=output.send(SessionOutput{session_id:id.clone(),data:data.to_vec()});},Some(ChannelMsg::ExitStatus{..})|None=>break,_=>{}}
        }
    }
    emit_status(
        &app,
        &id,
        &profile.id,
        &profile.name,
        SessionStatus::Disconnected,
        None,
    );
    Ok(())
}

fn ssh_client_config(settings: &AppSettings) -> client::Config {
    client::Config {
        // Interactive shells exchange very small packets. Disabling Nagle's
        // algorithm avoids delayed-ACK stalls on each remote-echoed keypress.
        nodelay: true,
        inactivity_timeout: Some(Duration::from_secs(settings.inactivity_timeout_seconds)),
        keepalive_interval: Some(Duration::from_secs(settings.keepalive_interval_seconds)),
        keepalive_max: 3,
        ..Default::default()
    }
}
fn emit_status(
    app: &AppHandle,
    id: &str,
    profile_id: &str,
    profile_name: &str,
    status: SessionStatus,
    last_error: Option<String>,
) {
    let _ = app.emit(
        "session-status",
        SessionSummary {
            id: id.into(),
            profile_id: profile_id.into(),
            profile_name: profile_name.into(),
            status,
            last_error,
        },
    );
}
fn user_error(error: &str) -> String {
    let (_, message) = error.split_once(':').unwrap_or(("", error));
    if error.starts_with("auth:") {
        format!("Authentication failed: {message}")
    } else if error.starts_with("key:") {
        format!("Private key could not be loaded: {message}")
    } else if error.starts_with("connect:") {
        format!("Could not reach the server: {message}")
    } else {
        message.into()
    }
}

#[cfg(test)]
mod cleanup_tests {
    use super::{Control, SessionCleanup, SessionManager};
    use std::sync::Arc;
    use tokio::sync::{mpsc, oneshot};

    #[test]
    fn dropping_the_cleanup_guard_empties_both_maps() {
        let manager = SessionManager::default();
        let (control_tx, _control_rx) = mpsc::unbounded_channel::<Control>();
        let (approval_tx, _approval_rx) = oneshot::channel::<bool>();
        manager
            .sessions
            .lock()
            .unwrap()
            .insert("abc".into(), control_tx);
        manager
            .approvals
            .lock()
            .unwrap()
            .insert("abc".into(), approval_tx);

        drop(SessionCleanup {
            id: "abc".into(),
            sessions: Arc::clone(&manager.sessions),
            approvals: Arc::clone(&manager.approvals),
        });

        assert!(manager.sessions.lock().unwrap().is_empty());
        assert!(manager.approvals.lock().unwrap().is_empty());
    }

    #[test]
    fn disconnecting_an_already_cleaned_session_reports_not_found() {
        let manager = SessionManager::default();
        assert_eq!(
            manager.disconnect("missing"),
            Err("Session not found".to_string())
        );
    }
}

#[cfg(test)]
mod runtime_tests {
    use super::ssh_client_config;
    use crate::models::AppSettings;
    use std::{sync::mpsc, time::Duration};

    #[test]
    fn tauri_runtime_spawns_from_a_synchronous_thread() {
        let (completed_tx, completed_rx) = mpsc::channel();
        let task = tauri::async_runtime::spawn(async move {
            completed_tx.send(()).expect("test receiver is alive");
        });

        completed_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("task should run on Tauri's managed runtime");
        tauri::async_runtime::block_on(task).expect("spawned task should finish cleanly");
    }

    #[test]
    fn interactive_ssh_connections_disable_nagles_algorithm() {
        assert!(ssh_client_config(&AppSettings::default()).nodelay);
    }
}
