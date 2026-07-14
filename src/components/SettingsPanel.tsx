import { useEffect, useMemo, useState } from "react";
import { Activity, BookOpen, Cable, Check, Info, Monitor, Save, Settings, SlidersHorizontal, TerminalSquare } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import changelog from "../../CHANGELOG.md?raw";
import { version } from "../../package.json";
import type { AppSettings, ThemeDefinition } from "../domain";
import { validateAppSettings } from "../domain";
import { ThemeEditor } from "./ThemeEditor";

type Tab = "general" | "terminal" | "connections" | "advanced" | "changelog" | "about";
const tabs: Array<{ id: Tab; label: string; hint: string; icon: typeof Settings }> = [
  { id: "general", label: "General", hint: "Session behavior", icon: SlidersHorizontal },
  { id: "terminal", label: "Terminal", hint: "Themes and typography", icon: TerminalSquare },
  { id: "connections", label: "Connections", hint: "Safe SSH defaults", icon: Cable },
  { id: "advanced", label: "Advanced", hint: "Rendering and diagnostics", icon: Activity },
  { id: "changelog", label: "Changelog", hint: "Release notes and updates", icon: BookOpen },
  { id: "about", label: "About", hint: "Version and storage", icon: Info },
];

export function SettingsPanel({ settings, themes, onSaveSettings, onSelectTheme, onSaveTheme, onDeleteTheme }: {
  settings: AppSettings;
  themes: ThemeDefinition[];
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onSelectTheme: (id: string) => Promise<void>;
  onSaveTheme: (theme: ThemeDefinition) => Promise<void>;
  onDeleteTheme: (id: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setDraft(settings), [settings]);
  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const persist = async () => { const problem = validateAppSettings(draft); if (problem) { setError(problem); return; } setError(""); try { await onSaveSettings(draft); setSaved(true); window.setTimeout(() => setSaved(false), 1400); } catch (reason) { setError(String(reason)); } };
  const title = tabs.find((item) => item.id === tab)?.label;
  return <main className="settings-page">
    <aside className="settings-nav">
      <div className="settings-nav-title"><Settings size={17}/><span>Settings</span></div>
      <div className="settings-nav-items">{tabs.map(({ id, label, hint, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={17}/><span><strong>{label}</strong><small>{hint}</small></span></button>)}</div>
    </aside>
    <section className="settings-content">
      <header className="settings-head"><div><span className="settings-kicker">Sesh settings</span><h1>{title}</h1></div>{error ? <span className="save-pulse failed">{error}</span> : saved && <span className="save-pulse"><Check size={13}/>Saved</span>}</header>
      {tab === "general" && <div className="settings-stack">
        <SettingCard title="Session behavior" description="Choose how Sesh handles new and active terminal workspaces.">
          <Toggle label="Confirm before closing live sessions" hint="Ask before disconnecting a connected SSH session." checked={draft.confirmCloseSessions} onChange={(value) => patch("confirmCloseSessions", value)}/>
          <Toggle label="Focus newly connected sessions" hint="Open the new workspace as soon as a connection begins." checked={draft.focusNewSessions} onChange={(value) => patch("focusNewSessions", value)}/>
        </SettingCard><SaveBar onSave={persist}/>
      </div>}
      {tab === "terminal" && <div className="settings-terminal"><ThemeEditor embedded themes={themes} selectedId={settings.globalThemeId} onSelect={(id) => void onSelectTheme(id)} onSave={onSaveTheme} onDelete={onDeleteTheme}/></div>}
      {tab === "connections" && <div className="settings-stack">
        <SettingCard title="New machine defaults" description="These defaults are used only when creating a machine; existing profiles are unchanged.">
          <SettingField label="Default SSH port" hint="Valid ports: 1–65535"><input type="number" min="1" max="65535" value={draft.defaultPort} onChange={(event) => patch("defaultPort", Number(event.target.value))}/></SettingField>
        </SettingCard>
        <SettingCard title="Interactive SSH" description="Applied to new connections only. Active sessions keep the values they started with.">
          <div className="settings-field-grid"><SettingField label="Terminal type" hint="Reported to the remote shell"><input value={draft.terminalType} maxLength={64} onChange={(event) => patch("terminalType", event.target.value)}/></SettingField><SettingField label="Keepalive interval" hint="5–300 seconds"><input type="number" min="5" max="300" value={draft.keepaliveIntervalSeconds} onChange={(event) => patch("keepaliveIntervalSeconds", Number(event.target.value))}/></SettingField><SettingField label="Inactivity timeout" hint="30–3600 seconds"><input type="number" min="30" max="3600" value={draft.inactivityTimeoutSeconds} onChange={(event) => patch("inactivityTimeoutSeconds", Number(event.target.value))}/></SettingField></div>
        </SettingCard><SaveBar onSave={persist}/>
      </div>}
      {tab === "advanced" && <div className="settings-stack">
        <SettingCard title="Terminal renderer" description="Canvas is a compatibility fallback. Reopen terminal panes after changing this option.">
          <div className="choice-row"><button className={draft.terminalRenderer === "auto" ? "active" : ""} onClick={() => patch("terminalRenderer", "auto")}><Monitor size={17}/><span><strong>Automatic</strong><small>Use WebGL when available</small></span></button><button className={draft.terminalRenderer === "canvas" ? "active" : ""} onClick={() => patch("terminalRenderer", "canvas")}><Monitor size={17}/><span><strong>Canvas</strong><small>Maximum compatibility</small></span></button></div>
        </SettingCard>
        <SettingCard title="Latency diagnostics" description="Diagnostic output is dormant by default and never records credentials or terminal content.">
          <Toggle label="Frontend latency timestamps" hint="Writes input, receive, and paint stages to the WebView console. Reopen panes after changing." checked={draft.frontendLatencyTracing} onChange={(value) => patch("frontendLatencyTracing", value)}/>
          <div className="diagnostic-note"><code>SESH_TRACE_LATENCY=1 npm run tauri dev</code><p>Launch from a terminal with this variable to add Rust transport and SSH stage timestamps.</p></div>
        </SettingCard>
        <SettingCard title="Linux Wayland compatibility" description="Sesh automatically disables WebKitGTK DMA-BUF rendering on Wayland to prevent terminal echo latency. X11, Windows, and macOS are unchanged."/>
        <SaveBar onSave={persist}/>
      </div>}
      {tab === "changelog" && <Changelog/ >}
      {tab === "about" && <div className="settings-stack"><SettingCard title="Sesh" description="A focused, customizable desktop SSH client."><dl className="about-grid"><dt>Version</dt><dd>{version}</dd><dt>Platform</dt><dd>{navigator.platform || "Desktop"}</dd><dt>Profiles and themes</dt><dd>Stored in the platform application-data directory.</dd><dt>Saved credentials</dt><dd>Stored in the operating system credential vault, never in SQLite.</dd><dt>Known hosts</dt><dd>Verified using an app-owned known_hosts file.</dd></dl></SettingCard></div>}
    </section>
  </main>;
}

function SettingCard({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) { return <section className="settings-card"><header><h2>{title}</h2><p>{description}</p></header>{children && <div className="settings-card-body">{children}</div>}</section>; }
function SettingField({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) { return <label className="settings-field"><span><strong>{label}</strong><small>{hint}</small></span>{children}</label>; }
function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="toggle-row"><span><strong>{label}</strong><small>{hint}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><i/></label>; }
function SaveBar({ onSave }: { onSave: () => void }) { return <div className="settings-save"><button className="button primary" onClick={onSave}><Save size={15}/>Save changes</button></div>; }

function Changelog() {
  const releases = useMemo(() => changelog.split(/^## /m), []);
  return <div className="changelog"><ReactMarkdown remarkPlugins={[remarkGfm]}>{releases[0]}</ReactMarkdown>{releases.slice(1).map((release, index) => { const [heading, ...body] = release.split("\n"); return <details key={heading} open={index === 0}><summary>{heading}</summary><div className="changelog-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{body.join("\n")}</ReactMarkdown></div></details>; })}</div>;
}
