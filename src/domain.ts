export type AuthKind = "password" | "privateKey";
export type SessionStatus = "connecting" | "verifying_host" | "authenticating" | "connected" | "disconnected" | "failed";

export interface MachineProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authKind: AuthKind;
  privateKeyPath?: string;
  hasSavedPassword: boolean;
  hasSavedPassphrase: boolean;
  themeId?: string;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt?: string;
}

export interface MachineDraft {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authKind: AuthKind;
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
  savePassword: boolean;
  savePassphrase: boolean;
  themeId?: string;
}

export interface ThemePalette {
  foreground: string; background: string; cursor: string; cursorAccent: string;
  selectionBackground: string; selectionForeground: string;
  ansi: string[];
}

export interface ThemeDefinition {
  schemaVersion: 1;
  id: string; name: string; builtIn: boolean;
  palette: ThemePalette;
  fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number; letterSpacing: number;
  cursorStyle: "block" | "underline" | "bar"; cursorBlink: boolean;
  padding: number; scrollback: number; backgroundOpacity: number;
  backgroundImage?: string; backgroundImageOpacity: number;
}

export interface SessionSummary {
  id: string; profileId: string; profileName: string; status: SessionStatus; lastError?: string;
}

export interface HostKeyChallenge {
  sessionId: string; host: string; port: number; algorithm: string; fingerprint: string; kind: "new" | "changed";
}

export interface SessionOutput { sessionId: string; data: number[] }

export type TerminalRenderer = "auto" | "canvas";
export interface AppSettings {
  schemaVersion: 1;
  globalThemeId: string;
  confirmCloseSessions: boolean;
  focusNewSessions: boolean;
  defaultPort: number;
  terminalType: string;
  keepaliveIntervalSeconds: number;
  inactivityTimeoutSeconds: number;
  terminalRenderer: TerminalRenderer;
  frontendLatencyTracing: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  schemaVersion: 1,
  globalThemeId: "sesh-midnight",
  confirmCloseSessions: true,
  focusNewSessions: true,
  defaultPort: 22,
  terminalType: "xterm-256color",
  keepaliveIntervalSeconds: 20,
  inactivityTimeoutSeconds: 60,
  terminalRenderer: "auto",
  frontendLatencyTracing: false,
};

export function validateAppSettings(settings: AppSettings): string | undefined {
  if (!Number.isInteger(settings.defaultPort) || settings.defaultPort < 1 || settings.defaultPort > 65535) return "Default port must be between 1 and 65535.";
  if (!/^[A-Za-z0-9._+-]{1,64}$/.test(settings.terminalType)) return "Terminal type may contain only letters, numbers, periods, underscores, plus signs, and hyphens.";
  if (!Number.isInteger(settings.keepaliveIntervalSeconds) || settings.keepaliveIntervalSeconds < 5 || settings.keepaliveIntervalSeconds > 300) return "Keepalive interval must be between 5 and 300 seconds.";
  if (!Number.isInteger(settings.inactivityTimeoutSeconds) || settings.inactivityTimeoutSeconds < 30 || settings.inactivityTimeoutSeconds > 3600) return "Inactivity timeout must be between 30 and 3600 seconds.";
  return undefined;
}

export const emptyDraft = (defaultPort = 22): MachineDraft => ({ name: "", host: "", port: defaultPort, username: "", authKind: "password", savePassword: false, savePassphrase: false });

export function validateMachine(draft: MachineDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "Give this machine a name.";
  if (!draft.host.trim() || /\s/.test(draft.host)) errors.host = "Enter a valid hostname or IP address.";
  if (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) errors.port = "Port must be between 1 and 65535.";
  if (!draft.username.trim() || /\s/.test(draft.username)) errors.username = "Enter an SSH username.";
  if (draft.authKind === "privateKey" && !draft.privateKeyPath?.trim()) errors.privateKeyPath = "Choose a private key.";
  return errors;
}
