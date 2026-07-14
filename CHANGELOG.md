# Changelog

All notable changes to Sesh are recorded here. Releases follow semantic versioning while the application is in active development.

## 0.1.0 — July 13, 2026

### Interface

- Introduced the HyprFlat application shell, compact machine dashboard, persistent navigation rail, and full settings panel.
- Added configurable terminal themes with Kitty imports, custom palettes, typography, cursor styles, transparency, and background images.
- Added workspace tabs and up to four simultaneous split SSH panes.

### SSH and security

- Added password and private-key authentication with secrets stored in the operating system credential vault.
- Added explicit unknown-host verification and blocking for changed host keys.
- Added configurable PTY type, keepalive interval, inactivity timeout, and default port.

### Terminal responsiveness

- Replaced per-keystroke JSON IPC with an authenticated binary loopback WebSocket transport.
- Enabled TCP_NODELAY for both the SSH connection and local terminal transport.
- Disabled WebKitGTK DMA-BUF rendering on Wayland after tracing showed it caused visible terminal echo latency.
- Added dormant frontend and Rust latency diagnostics for future regressions.
