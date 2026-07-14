import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppSettings, HostKeyChallenge, MachineDraft, MachineProfile, SessionOutput, SessionSummary, ThemeDefinition } from "./domain";
import { DEFAULT_APP_SETTINGS } from "./domain";
import { BUILTIN_THEMES } from "./themes";
import { nativeTerminalTransport } from "./terminalTransport";

const native = () => "__TAURI_INTERNALS__" in window;
const PROFILES = "sesh.dev.profiles"; const THEMES = "sesh.dev.themes"; const SETTINGS = "sesh.dev.settings";
const read = <T>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; } };
const emit = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

export const api = {
  isNative: native,
  async listProfiles(): Promise<MachineProfile[]> { return native() ? invoke("list_profiles") : read(PROFILES, []); },
  async saveProfile(draft: MachineDraft): Promise<MachineProfile> {
    if (native()) return invoke("save_profile", { draft });
    const all = read<MachineProfile[]>(PROFILES, []); const old = all.find((x) => x.id === draft.id); const now = new Date().toISOString();
    const saved: MachineProfile = { ...draft, id: draft.id || crypto.randomUUID(), privateKeyPath: draft.privateKeyPath || undefined, hasSavedPassword: !!draft.savePassword && !!draft.password || old?.hasSavedPassword || false, hasSavedPassphrase: !!draft.savePassphrase && !!draft.passphrase || old?.hasSavedPassphrase || false, createdAt: old?.createdAt || now, updatedAt: now };
    localStorage.setItem(PROFILES, JSON.stringify([...all.filter((x) => x.id !== saved.id), saved])); return saved;
  },
  async deleteProfile(id: string) { if (native()) return invoke("delete_profile", { id }); localStorage.setItem(PROFILES, JSON.stringify(read<MachineProfile[]>(PROFILES, []).filter((x) => x.id !== id))); },
  async listThemes(): Promise<ThemeDefinition[]> { return native() ? [...BUILTIN_THEMES, ...await invoke<ThemeDefinition[]>("list_themes")] : [...BUILTIN_THEMES, ...read<ThemeDefinition[]>(THEMES, [])]; },
  async saveTheme(theme: ThemeDefinition): Promise<ThemeDefinition> { if (native()) return invoke("save_theme", { theme }); const all = read<ThemeDefinition[]>(THEMES, []); localStorage.setItem(THEMES, JSON.stringify([...all.filter((x) => x.id !== theme.id), theme])); return theme; },
  async deleteTheme(id: string) { if (native()) return invoke("delete_theme", { id }); localStorage.setItem(THEMES, JSON.stringify(read<ThemeDefinition[]>(THEMES, []).filter((x) => x.id !== id))); },
  async getSettings(): Promise<AppSettings> {
    const value = native() ? await invoke<AppSettings>("get_app_settings") : read<AppSettings>(SETTINGS, DEFAULT_APP_SETTINGS);
    const merged = { ...DEFAULT_APP_SETTINGS, ...value, schemaVersion: 1 } as AppSettings;
    const legacyTheme = localStorage.getItem("sesh.globalTheme");
    if (legacyTheme) {
      merged.globalThemeId = legacyTheme;
      if (native()) await invoke<AppSettings>("save_app_settings", { settings: merged });
      else localStorage.setItem(SETTINGS, JSON.stringify(merged));
      localStorage.removeItem("sesh.globalTheme");
    }
    return merged;
  },
  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const saved = native() ? await invoke<AppSettings>("save_app_settings", { settings }) : settings;
    localStorage.setItem(SETTINGS, JSON.stringify(saved));
    localStorage.setItem("sesh.disableWebgl", saved.terminalRenderer === "canvas" ? "1" : "0");
    localStorage.setItem("sesh.traceLatency", saved.frontendLatencyTracing ? "1" : "0");
    return saved;
  },
  async connect(profileId: string, password?: string, passphrase?: string): Promise<SessionSummary> {
    if (native()) { await nativeTerminalTransport.connect(); return invoke("connect_session", { request: { profileId, password, passphrase } }); }
    const profile = read<MachineProfile[]>(PROFILES, []).find((x) => x.id === profileId)!; const session = { id: crypto.randomUUID(), profileId, profileName: profile.name, status: "connecting" as const };
    setTimeout(() => emit("sesh:session-status", { ...session, status: "connected" }), 350);
    setTimeout(() => emit("sesh:session-output", { sessionId: session.id, data: [...new TextEncoder().encode(`\r\n\x1b[38;2;123;216;143mConnected to ${profile.username}@${profile.host}\x1b[0m\r\nBrowser preview mode — run the Tauri app for a live SSH session.\r\n\r\n$ `)] }), 400);
    return session;
  },
  sendInput(sessionId: string, data: string) { if (native()) { nativeTerminalTransport.sendInput(sessionId, data); return; } emit("sesh:session-output", { sessionId, data: [...new TextEncoder().encode(data)] }); },
  resize(sessionId: string, cols: number, rows: number) { if (native()) { nativeTerminalTransport.resize(sessionId, cols, rows); return; } },
  async disconnect(sessionId: string) { if (native()) return invoke("disconnect_session", { sessionId }); emit("sesh:session-status", { id: sessionId, status: "disconnected" }); },
  async approveHostKey(sessionId: string, approve: boolean) { return native() ? invoke("approve_host_key", { sessionId, approve }) : undefined; },
  onOutput(sessionId: string, cb: (data: Uint8Array) => void): Promise<UnlistenFn | (() => void)> { if (native()) return Promise.resolve(nativeTerminalTransport.subscribe(sessionId, cb)); const fn = (e: Event) => { const value = (e as CustomEvent<SessionOutput>).detail; if (value.sessionId === sessionId) cb(new Uint8Array(value.data)); }; window.addEventListener("sesh:session-output", fn); return Promise.resolve(() => window.removeEventListener("sesh:session-output", fn)); },
  onStatus(cb: (event: SessionSummary) => void): Promise<UnlistenFn | (() => void)> { if (native()) return listen("session-status", (e) => cb(e.payload as SessionSummary)); const fn = (e: Event) => cb((e as CustomEvent).detail); window.addEventListener("sesh:session-status", fn); return Promise.resolve(() => window.removeEventListener("sesh:session-status", fn)); },
  onHostKey(cb: (event: HostKeyChallenge) => void): Promise<UnlistenFn | (() => void)> { if (native()) return listen("host-key-challenge", (e) => cb(e.payload as HostKeyChallenge)); return Promise.resolve(() => {}); },
};
