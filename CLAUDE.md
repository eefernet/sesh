# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

sesh is a desktop SSH client built with Tauri 2: React 19 + TypeScript frontend (`src/`), Rust backend (`src-tauri/`, crate `sesh_lib`, edition 2024, requires Rust 1.88+). It manages machine profiles, opens concurrent SSH terminals in workspace tabs and split panes, verifies host keys, and stores secrets in the OS credential vault (never in SQLite).

## Commands

- `npm run dev` — browser preview at port 1420 (no real SSH; uses the localStorage shim in `src/api.ts`)
- `npm run tauri dev` — run the full native desktop app
- `npm run build` — `tsc && vite build`; this is also the typecheck (`strict: true`, `noEmit`)
- `npm test` — run all frontend tests (Vitest, jsdom)
- `npx vitest run src/domain.test.ts` — single test file; `npx vitest run -t "pattern"` filters by name
- `cargo test` (from `src-tauri/`) — Rust tests; `cargo test <name>` for one test. CI does not run these — run them locally when touching Rust.
- `npm run tauri build -- --no-bundle` — what CI's native job builds

There is no ESLint/Prettier/rustfmt config or lint script.

## Architecture

Two-process Tauri app with a **dual transport split**: control-plane commands go over Tauri IPC (`invoke`), but terminal I/O flows over a separate authenticated binary WebSocket on loopback for latency.

### Backend (`src-tauri/src/`)

- `lib.rs` — builds the Tauri app; `AppState { db, sessions, known_hosts, terminal_transport }`; registers all `#[tauri::command]` handlers (profiles/themes/settings CRUD, `connect_session`, `terminal_transport_info`, `disconnect_session`, `approve_host_key`). Also `prepare_runtime()`, the Wayland DMA-BUF workaround (`WEBKIT_DISABLE_DMABUF_RENDERER`) that must run before any GTK/Tauri thread starts.
- `ssh.rs` — `SessionManager` with per-session mpsc control channels and a broadcast output channel. `run_session()` drives the russh state machine (VerifyingHost → Authenticating → Connected → Disconnected/Failed). `HostVerifier`: unknown host keys emit a `host-key-challenge` event and block on a oneshot (120s timeout) until the frontend calls `approve_host_key`; changed keys are rejected outright.
- `terminal_transport.rs` — WebSocket server on `127.0.0.1:0`, guarded by a random 32-byte hex token sent as the first client message. Binary frames: byte 0 = op (1 input, 2 resize, 3 disconnect), bytes 1..17 = session UUID, rest = payload. Output frames = 16-byte UUID + raw bytes. `SESH_TRACE_LATENCY=1` enables latency traces.
- `db.rs` — SQLite (WAL) with tables `profiles`, `themes`, `settings`; themes and settings are stored as JSON blobs.
- `secrets.rs` — keyring adapter, service `com.sesh.terminal`, account `"{profile_id}:{kind}"`.
- `models.rs` — serde structs use `#[serde(rename_all = "camelCase")]` to match TS (exceptions: `SessionStatus` is snake_case, `TerminalRenderer` lowercase).

### Frontend (`src/`)

- `App.tsx` — single stateful root component: profiles/themes/settings, `Workspace[]` of `SessionSummary[]` panes, modals. Each OS window runs its own App instance; workspaces are per-window state.
- `detach.ts` + `terminalRegistry.ts` — tab tear-out. Dragging a workspace tab outside the window (`decideDragEnd`) opens a new `workspace-*` window that adopts the workspace via a Tauri event handshake (`sesh:handoff-request` → `sesh:handoff-payload-<id>`), carrying an xterm SerializeAddon snapshot so scrollback survives. The source removes the tab without disconnecting; the child's own WebSocket re-attaches by session id (backend output is a global broadcast, so this needs no backend support). Windows also exchange `sesh:data-changed` to refresh profiles/themes/settings after edits.
- `api.ts` — the central abstraction. Every method branches on `"__TAURI_INTERNALS__" in window`: native → `invoke`/WebSocket; browser → localStorage + simulated CustomEvents. This is what makes `npm run dev` work without a backend — new backend commands need a browser-mode counterpart here.
- `terminalTransport.ts` — `NativeTerminalTransport` singleton: WebSocket client, frame encode/decode, reconnect with backoff (max 5 attempts).
- `domain.ts` — all TS types, `DEFAULT_APP_SETTINGS`, validators.
- `themes.ts` — built-in themes and `parseKittyTheme()` (Kitty conf import).
- `components/` — `MachineEditor`, `SettingsPanel`, `TerminalPane` (xterm host), `ThemeEditor`, `Modal`.

### Event flow

Rust emits Tauri events `session-status` and `host-key-challenge` (consumed via `api.onStatus`/`api.onHostKey`). Both fan out to every window; `host-key-challenge` carries `windowLabel` (the window that called `connect_session`) and each window filters against its own label. Terminal output does NOT use Tauri events — it flows over the WebSocket to `nativeTerminalTransport.subscribe`.

## Cross-cutting invariants

- **Settings validation is intentionally duplicated** in `src/domain.ts` (`validateAppSettings`) and `src-tauri/src/lib.rs` (`validate_settings`) with identical bounds (port 1-65535, keepalive 5-300s, inactivity 30-3600s, terminal type `[A-Za-z0-9._+-]{1,64}`). Change both together.
- Secrets go through `secrets.rs`/keyring only — never into SQLite.
- The CSP in `src-tauri/tauri.conf.json` explicitly allows `ws://127.0.0.1:*` for the terminal transport; keep it in sync if the transport changes.

## Testing

Frontend tests are colocated `*.test.ts` files (`src/domain.test.ts`, `src/themes.test.ts`, `src/terminalTransport.test.ts`); Vitest config is inherited from `vite.config.ts`. Rust tests are inline `#[cfg(test)]` modules per file; some are gated `#[cfg(all(test, target_os = "linux"))]` (Wayland tests).
