import { useEffect, useMemo, useState } from "react";
import { Edit3, KeyRound, LayoutDashboard, MoreVertical, Plus, Search, Server, Settings, SplitSquareHorizontal, TerminalSquare, Trash2, Wifi, X } from "lucide-react";
import { api } from "./api";
import type { AppSettings, HostKeyChallenge, MachineDraft, MachineProfile, SessionSummary, ThemeDefinition } from "./domain";
import { DEFAULT_APP_SETTINGS } from "./domain";
import { defaultTheme } from "./themes";
import { MachineEditor } from "./components/MachineEditor";
import { TerminalPane } from "./components/TerminalPane";
import { SettingsPanel } from "./components/SettingsPanel";
import { Modal } from "./components/Modal";

interface Workspace { id: string; name: string; sessions: SessionSummary[] }
interface PendingLogin { profile: MachineProfile; splitWorkspaceId?: string }
type MainView = "machines" | "settings";

export default function App() {
  const [profiles, setProfiles] = useState<MachineProfile[]>([]);
  const [themes, setThemes] = useState<ThemeDefinition[]>([defaultTheme]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<MainView>("machines");
  const [editor, setEditor] = useState<MachineProfile | null | "new">(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingLogin>();
  const [splitPicker, setSplitPicker] = useState(false);
  const [hostKey, setHostKey] = useState<HostKeyChallenge>();

  const globalTheme = themes.find((theme) => theme.id === settings.globalThemeId) || themes[0] || defaultTheme;
  const active = workspaces.find((workspace) => workspace.id === activeWorkspace);
  const refresh = async () => {
    const [nextProfiles, nextThemes, nextSettings] = await Promise.all([api.listProfiles(), api.listThemes(), api.getSettings()]);
    setProfiles(nextProfiles); setThemes(nextThemes); setSettings(nextSettings); setLoading(false);
  };
  useEffect(() => {
    void refresh();
    let offStatus = () => {}; let offHost = () => {};
    api.onStatus((next) => setWorkspaces((all) => all.map((workspace) => ({ ...workspace, sessions: workspace.sessions.map((session) => session.id === next.id ? { ...session, ...next } : session) })))).then((off) => offStatus = off);
    api.onHostKey(setHostKey).then((off) => offHost = off);
    return () => { offStatus(); offHost(); };
  }, []);

  const filtered = useMemo(() => profiles.filter((profile) => `${profile.name} ${profile.host} ${profile.username}`.toLowerCase().includes(query.toLowerCase())), [profiles, query]);
  const saveProfile = async (draft: MachineDraft) => { await api.saveProfile(draft); setEditor(null); await refresh(); };
  const removeProfile = async (profile: MachineProfile) => { if (!confirm(`Delete ${profile.name}? Saved credentials for this machine will also be removed.`)) return; await api.deleteProfile(profile.id); await refresh(); };
  const beginConnect = (profile: MachineProfile, splitWorkspaceId?: string) => {
    if ((profile.authKind === "password" && !profile.hasSavedPassword) || (profile.authKind === "privateKey" && !profile.hasSavedPassphrase)) setPending({ profile, splitWorkspaceId });
    else void connect(profile, splitWorkspaceId);
  };
  const connect = async (profile: MachineProfile, splitWorkspaceId?: string, secret?: string) => {
    setPending(undefined); setSplitPicker(false);
    const session = await api.connect(profile.id, profile.authKind === "password" ? secret : undefined, profile.authKind === "privateKey" ? secret : undefined);
    setView("machines");
    if (splitWorkspaceId) setWorkspaces((all) => all.map((workspace) => workspace.id === splitWorkspaceId ? { ...workspace, sessions: [...workspace.sessions, session] } : workspace));
    else { const id = crypto.randomUUID(); setWorkspaces((all) => [...all, { id, name: profile.name, sessions: [session] }]); if (settings.focusNewSessions) setActiveWorkspace(id); }
  };
  const closeSession = async (workspaceId: string, session: SessionSummary) => {
    if (settings.confirmCloseSessions && session.status === "connected" && !confirm(`Close the live ${session.profileName} session?`)) return;
    await api.disconnect(session.id);
    setWorkspaces((all) => all.flatMap((workspace) => { if (workspace.id !== workspaceId) return [workspace]; const sessions = workspace.sessions.filter((item) => item.id !== session.id); return sessions.length ? [{ ...workspace, sessions }] : []; }));
  };
  const closeWorkspace = async (workspace: Workspace) => {
    if (settings.confirmCloseSessions && workspace.sessions.some((session) => session.status === "connected") && !confirm(`Close ${workspace.name} and disconnect its live sessions?`)) return;
    await Promise.all(workspace.sessions.map((session) => api.disconnect(session.id)));
    setWorkspaces((all) => all.filter((item) => item.id !== workspace.id));
    if (activeWorkspace === workspace.id) setActiveWorkspace(null);
  };
  const saveTheme = async (theme: ThemeDefinition) => { const saved = await api.saveTheme(theme); setThemes(await api.listThemes()); if (!theme.builtIn) await selectTheme(saved.id); };
  const saveSettings = async (next: AppSettings) => setSettings(await api.saveSettings(next));
  const selectTheme = async (id: string) => saveSettings({ ...settings, globalThemeId: id });
  const showMachines = () => { setView("machines"); setActiveWorkspace(null); };

  return <div className="app-shell">
    <aside className="app-rail">
      <button className="rail-brand" title="Sesh" onClick={showMachines}>$</button>
      <button className={view === "machines" && !active ? "active" : ""} onClick={showMachines}><LayoutDashboard size={19}/><span>Machines</span></button>
      <div className="rail-spacer"/>
      <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><Settings size={19}/><span>Settings</span></button>
    </aside>
    <div className="app-main">
      <header className="titlebar">
        <div className="page-context">{view === "settings" ? <><Settings size={15}/>Settings</> : active ? <><TerminalSquare size={15}/>{active.name}</> : <><LayoutDashboard size={15}/>Machines</>}</div>
        <nav className="workspace-tabs">{workspaces.map((workspace) => <button key={workspace.id} className={view === "machines" && activeWorkspace === workspace.id ? "active" : ""} onClick={() => { setView("machines"); setActiveWorkspace(workspace.id); }}><span className={`status-dot ${workspace.sessions.some((session) => session.status === "connected") ? "connected" : "connecting"}`}/>{workspace.name}<span className="tab-close" onClick={(event) => { event.stopPropagation(); void closeWorkspace(workspace); }}><X size={13}/></span></button>)}</nav>
      </header>
      {view === "settings" ? <SettingsPanel settings={settings} themes={themes} onSaveSettings={saveSettings} onSelectTheme={selectTheme} onSaveTheme={saveTheme} onDeleteTheme={async (id) => { await api.deleteTheme(id); const next = await api.listThemes(); setThemes(next); if (id === settings.globalThemeId) await selectTheme(defaultTheme.id); }}/>
      : !active ? <main className="dashboard">
        <div className="dashboard-tools"><div className="search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search machines, hosts, or users…"/></div><span className="machine-count">{profiles.length} {profiles.length === 1 ? "machine" : "machines"}</span><button className="button primary" onClick={() => setEditor("new")}><Plus size={17}/>Add machine</button></div>
        {loading ? <div className="empty"><span className="spinner"/><p>Loading machines…</p></div> : filtered.length ? <div className="machine-grid">{filtered.map((profile) => <MachineCard key={profile.id} profile={profile} theme={themes.find((theme) => theme.id === profile.themeId) || globalTheme} onConnect={() => beginConnect(profile)} onEdit={() => setEditor(profile)} onDelete={() => removeProfile(profile)}/>)}</div> : profiles.length ? <div className="empty"><Search/><h2>No machines found</h2><p>Try a different search.</p></div> : <div className="empty empty-card"><div className="empty-icon"><TerminalSquare/></div><h2>Your next session starts here</h2><p>Add a server, development box, or Raspberry Pi. Credentials can stay in your operating system’s secure vault.</p><button className="button primary" onClick={() => setEditor("new")}><Plus size={17}/>Add your first machine</button></div>}
      </main>
      : <main className="workspace"><div className="workspace-toolbar"><div><TerminalSquare size={17}/><strong>{active.name}</strong><span>{active.sessions.length} {active.sessions.length === 1 ? "pane" : "panes"}</span></div><button className="button secondary compact" onClick={() => setSplitPicker(true)}><SplitSquareHorizontal size={16}/>Split session</button></div><div className={`terminal-grid panes-${Math.min(active.sessions.length, 4)}`}>{active.sessions.map((session) => <TerminalPane key={session.id} session={session} theme={themes.find((theme) => theme.id === profiles.find((profile) => profile.id === session.profileId)?.themeId) || globalTheme} onClose={() => closeSession(active.id, session)} onReconnect={() => { const profile = profiles.find((item) => item.id === session.profileId); if (profile) beginConnect(profile, active.id); }}/>)}</div></main>}
    </div>
    {editor && <MachineEditor profile={editor === "new" ? undefined : editor} themes={themes} defaultPort={settings.defaultPort} onSave={saveProfile} onClose={() => setEditor(null)}/>} 
    {pending && <SecretPrompt pending={pending} onClose={() => setPending(undefined)} onConnect={(secret) => void connect(pending.profile, pending.splitWorkspaceId, secret)}/>} 
    {splitPicker && active && <Modal title="Choose a machine for this split" onClose={() => setSplitPicker(false)}><div className="picker-list">{profiles.map((profile) => <button key={profile.id} onClick={() => beginConnect(profile, active.id)}><Server size={18}/><span><strong>{profile.name}</strong><small>{profile.username}@{profile.host}</small></span></button>)}</div></Modal>}
    {hostKey && <HostKeyModal challenge={hostKey} onDone={async (approve) => { await api.approveHostKey(hostKey.sessionId, approve); setHostKey(undefined); }}/>} 
  </div>;
}

function MachineCard({ profile, theme, onConnect, onEdit, onDelete }: { profile: MachineProfile; theme: ThemeDefinition; onConnect: () => void; onEdit: () => void; onDelete: () => void }) { const [menu, setMenu] = useState(false); return <article className="machine-card" onClick={onConnect}><div className="machine-accent" style={{ background: theme.palette.ansi[4] }}/><div className="machine-top"><div className="machine-icon" style={{ color: theme.palette.ansi[4], background: `${theme.palette.ansi[4]}18` }}><Server size={20}/></div><div className="card-menu"><button className="icon-button" onClick={(event) => { event.stopPropagation(); setMenu(!menu); }}><MoreVertical size={17}/></button>{menu && <div className="menu"><button onClick={(event) => { event.stopPropagation(); onEdit(); }}><Edit3 size={14}/>Edit</button><button className="danger-text" onClick={(event) => { event.stopPropagation(); onDelete(); }}><Trash2 size={14}/>Delete</button></div>}</div></div><h2>{profile.name}</h2><p className="machine-address">{profile.username}@{profile.host}{profile.port !== 22 ? `:${profile.port}` : ""}</p><div className="machine-meta"><span><KeyRound size={14}/>{profile.authKind === "privateKey" ? "Private key" : "Password"}</span>{profile.lastConnectedAt && <span>Recent</span>}</div><button className="connect-button"><Wifi size={15}/>Connect<span>↗</span></button></article>; }
function SecretPrompt({ pending, onClose, onConnect }: { pending: PendingLogin; onClose: () => void; onConnect: (secret: string) => void }) { const [secret, setSecret] = useState(""); return <Modal title={`Connect to ${pending.profile.name}`} onClose={onClose}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onConnect(secret); }}><p className="muted">Enter the {pending.profile.authKind === "password" ? "SSH password" : "private-key passphrase"} for <strong>{pending.profile.username}@{pending.profile.host}</strong>.</p><div className="field"><label>{pending.profile.authKind === "password" ? "Password" : "Passphrase"}</label><input autoFocus type="password" value={secret} onChange={(event) => setSecret(event.target.value)}/></div><footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary">Connect</button></footer></form></Modal>; }
function HostKeyModal({ challenge, onDone }: { challenge: HostKeyChallenge; onDone: (approve: boolean) => void }) { return <Modal title={challenge.kind === "changed" ? "Host identity changed" : "Trust this host?"} onClose={() => onDone(false)}><div className="host-key"><div className={challenge.kind === "changed" ? "warning-icon danger" : "warning-icon"}><KeyRound/></div><p>{challenge.kind === "changed" ? "The key presented by this server does not match the saved key. This can indicate an attack or a reinstalled server." : "Verify this fingerprint with the server administrator before continuing."}</p><dl><dt>Host</dt><dd>{challenge.host}:{challenge.port}</dd><dt>Algorithm</dt><dd>{challenge.algorithm}</dd><dt>Fingerprint</dt><dd><code>{challenge.fingerprint}</code></dd></dl><footer className="modal-actions"><button className="button secondary" onClick={() => onDone(false)}>Cancel connection</button>{challenge.kind === "new" && <button className="button primary" onClick={() => onDone(true)}>Trust and connect</button>}</footer></div></Modal>; }
