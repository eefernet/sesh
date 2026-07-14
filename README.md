# sesh

`sesh` is a focused, customizable desktop SSH client. It manages machine profiles, opens concurrent interactive SSH terminals in tabs and splits, verifies host keys, and keeps opted-in secrets in the operating system credential vault.

## Current features

- Machine dashboard with password and encrypted/unencrypted private-key authentication
- Concurrent interactive PTYs, workspace tabs, and up to four split panes
- Explicit unknown-host trust and blocking on changed host keys
- Linux Secret Service, macOS Keychain, and Windows Credential Manager through a shared credential adapter
- Curated terminal themes, per-machine overrides, advanced palette/typography controls, and Kitty theme import
- HyprFlat desktop shell with persistent Machines/Settings navigation and bundled release notes
- Settings for session behavior, terminal rendering, SSH defaults, and dormant latency diagnostics
- Browser preview mode with local demo persistence when running `npm run dev`

## Development

Requirements: Node.js 20+, Rust 1.88+, and the [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

```sh
npm install
npm test
npm run build
npm run tauri dev
```

The browser preview exercises the interface but does not create real SSH connections. Run the Tauri app for native persistence, credential storage, host verification, and SSH.

## Data and security

Profile and custom-theme metadata lives in `sesh.sqlite3` under the platform app-data directory. Host fingerprints use an app-owned `known_hosts` file beside it. Passwords and private-key passphrases are never stored in SQLite or frontend persistence.

Linux is the initial packaging target. The source and CI remain cross-platform; Windows signing and macOS signing/notarization are release prerequisites rather than architectural migrations.

### Linux Wayland

WebKitGTK's DMA-BUF renderer caused measurable terminal echo latency on Wayland and can terminate Tauri/Wry applications with `Error 71 (Protocol error)` on some NVIDIA configurations. `sesh` detects Wayland at startup and disables that renderer before the window is created. X11, Windows, and macOS are unaffected.

An explicitly supplied `WEBKIT_DISABLE_DMABUF_RENDERER` value overrides this compatibility behavior, allowing the upstream renderer to be retested after future WebKitGTK or NVIDIA driver updates.
