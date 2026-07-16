# Changelog

All notable changes to Sesh are recorded here. Releases follow semantic versioning while the application is in active development.

## Unreleased

### Interface

- Added tear-out tabs: drag a workspace tab outside the window to move it — scrollback included — into a new window, with any number of windows open at once. Closing a window disconnects only its own sessions, and host-key prompts appear only in the window that started the connection.
- Known limitation: on Wayland, cancelling a tab drag with Esc is indistinguishable from dropping outside the window and will detach the tab.
- Added in-terminal search (Ctrl+Shift+F) with next/previous matching.
- Added keyboard shortcuts: Ctrl+Tab / Ctrl+Shift+Tab and Ctrl+1–9 switch workspaces, Ctrl+Shift+W closes the current workspace, and Ctrl+Shift+N opens the new-machine editor.
- Added machine import and export as JSON — from the dashboard for all machines or per machine from its card menu. Exports never include passwords or passphrases.
- Replaced native confirmation dialogs with themed in-app dialogs and added toast notifications for connection failures, transport loss, and import results.
- Reconnecting a failed pane now replaces it in place instead of adding a duplicate pane, and workspace tabs now show a red status dot when every session has failed.
- Improved keyboard accessibility: visible focus rings, keyboard-operable machine cards and tab-close buttons, Escape-to-close modals with focus trapping, middle-click closes tabs, and card menus dismiss on outside click or Escape.
- Tear-out now preserves the full theme-configured scrollback instead of capping it at 1,000 lines.

### SSH and security

- Fixed a leak where finished or failed sessions were never removed from the session registry.
- Saved-credential indicators now reflect what the credential vault actually holds, so saving a profile with an empty password no longer claims a stored secret.
- Changed-host-key warnings can now be dismissed and explain how to resolve the mismatch; a machine's "recent" ordering only updates on successful connections.

### Terminal responsiveness

- Keystrokes typed while the terminal transport is connecting are queued and delivered in order instead of being dropped or reordered.
- The transport now reports when it loses the connection permanently and revives on the next keystroke; output bursts are far less likely to drop frames.

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
