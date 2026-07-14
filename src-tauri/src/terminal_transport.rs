use crate::{models::SessionOutput, ssh::SessionManager};
use futures_util::{SinkExt, StreamExt};
use rand::RngCore;
use serde::Serialize;
use std::{
    net::Ipv4Addr,
    sync::{Arc, LazyLock},
    time::Instant,
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::broadcast,
};
use tokio_tungstenite::{accept_async, tungstenite::Message};

const PROTOCOL_VERSION: u8 = 1;
const MAX_FRAME_SIZE: usize = 1024 * 1024;

static TRACE_EPOCH: LazyLock<Instant> = LazyLock::new(Instant::now);
static TRACE_ENABLED: LazyLock<bool> =
    LazyLock::new(|| trace_flag(std::env::var("SESH_TRACE_LATENCY").ok()));

fn trace_flag(value: Option<String>) -> bool {
    value.as_deref() == Some("1")
}

/// Stage timestamps for chasing per-keystroke latency. Off unless the app
/// runs with SESH_TRACE_LATENCY=1; all stages share one monotonic epoch.
pub fn trace_latency(stage: &str, bytes: usize) {
    if *TRACE_ENABLED {
        eprintln!(
            "[lat] {stage} {}us {bytes}B",
            TRACE_EPOCH.elapsed().as_micros()
        );
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTransportInfo {
    pub port: u16,
    pub token: String,
    pub protocol_version: u8,
}

pub async fn start(sessions: Arc<SessionManager>) -> Result<TerminalTransportInfo, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let mut secret = [0u8; 32];
    rand::rng().fill_bytes(&mut secret);
    let token = secret
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let server_token = token.clone();
    tauri::async_runtime::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let sessions = sessions.clone();
            let token = server_token.clone();
            tauri::async_runtime::spawn(async move {
                let _ = serve(stream, sessions, token).await;
            });
        }
    });
    Ok(TerminalTransportInfo {
        port,
        token,
        protocol_version: PROTOCOL_VERSION,
    })
}

fn configure_stream(stream: &TcpStream) -> Result<(), String> {
    // Terminal echo frames are tiny. Disabling Nagle's algorithm keeps them
    // from stalling behind the webview's delayed ACKs on each keypress.
    stream.set_nodelay(true).map_err(|e| e.to_string())
}

async fn serve(
    stream: TcpStream,
    sessions: Arc<SessionManager>,
    token: String,
) -> Result<(), String> {
    configure_stream(&stream)?;
    let mut socket = accept_async(stream).await.map_err(|e| e.to_string())?;
    match socket.next().await {
        Some(Ok(Message::Text(value))) if value.as_str() == token => {}
        _ => {
            let _ = socket.close(None).await;
            return Err("terminal transport authentication failed".into());
        }
    }
    let mut output = sessions.subscribe_output();
    loop {
        tokio::select! {
            incoming = socket.next() => match incoming {
                Some(Ok(Message::Binary(frame))) if frame.len() <= MAX_FRAME_SIZE => {
                    trace_latency("ws-in", frame.len());
                    dispatch_frame(&sessions, &frame)?
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(Message::Ping(data))) => socket.send(Message::Pong(data)).await.map_err(|e| e.to_string())?,
                Some(Ok(_)) => {}
                Some(Err(error)) => return Err(error.to_string()),
            },
            event = output.recv() => match event {
                Ok(event) => {
                    let bytes = event.data.len();
                    socket.send(Message::Binary(encode_output(event).into())).await.map_err(|e| e.to_string())?;
                    trace_latency("ws-out", bytes);
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }
    Ok(())
}

fn dispatch_frame(sessions: &SessionManager, frame: &[u8]) -> Result<(), String> {
    if frame.len() < 17 {
        return Err("invalid terminal frame".into());
    }
    let id = uuid::Uuid::from_slice(&frame[1..17])
        .map_err(|_| "invalid session id")?
        .to_string();
    match frame[0] {
        1 if frame.len() > 17 => sessions.input(&id, frame[17..].to_vec()),
        2 if frame.len() == 25 => {
            let cols = u32::from_be_bytes(frame[17..21].try_into().unwrap()).clamp(1, 1000);
            let rows = u32::from_be_bytes(frame[21..25].try_into().unwrap()).clamp(1, 1000);
            sessions.resize(&id, cols, rows)
        }
        3 if frame.len() == 17 => sessions.disconnect(&id),
        _ => Err("invalid terminal frame operation".into()),
    }
}

fn encode_output(event: SessionOutput) -> Vec<u8> {
    let Ok(id) = uuid::Uuid::parse_str(&event.session_id) else {
        return Vec::new();
    };
    let mut frame = Vec::with_capacity(16 + event.data.len());
    frame.extend_from_slice(id.as_bytes());
    frame.extend_from_slice(&event.data);
    frame
}

#[cfg(test)]
mod tests {
    use super::{configure_stream, encode_output, trace_flag};
    use crate::models::SessionOutput;
    use std::net::Ipv4Addr;
    use tokio::net::{TcpListener, TcpStream};

    #[tokio::test]
    async fn accepted_transport_streams_disable_nagles_algorithm() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let addr = listener.local_addr().unwrap();
        let _client = TcpStream::connect(addr).await.unwrap();
        let (stream, _) = listener.accept().await.unwrap();
        configure_stream(&stream).unwrap();
        assert!(stream.nodelay().unwrap());
    }

    #[test]
    fn latency_tracing_stays_off_unless_explicitly_enabled() {
        assert!(!trace_flag(None));
        assert!(!trace_flag(Some("0".into())));
        assert!(!trace_flag(Some("true".into())));
        assert!(trace_flag(Some("1".into())));
    }

    #[test]
    fn output_frames_preserve_session_and_bytes() {
        let id = uuid::Uuid::new_v4();
        let frame = encode_output(SessionOutput {
            session_id: id.to_string(),
            data: vec![0, 1, 255],
        });
        assert_eq!(&frame[..16], id.as_bytes());
        assert_eq!(&frame[16..], &[0, 1, 255]);
    }
}
