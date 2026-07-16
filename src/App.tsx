import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Edit3, KeyRound, LayoutDashboard, MoreVertical, Plus, Search, Server, Settings, SplitSquareHorizontal, TerminalSquare, Trash2, Upload, Wifi, X } from "lucide-react";
import { api } from "./api";
import type { AppSettings, HostKeyChallenge, MachineDraft, MachineProfile, SessionSummary, ThemeDefinition } from "./domain";
import { DEFAULT_APP_SETTINGS, parseMachineImport, serializeMachineExport } from "./domain";
import { downloadJson, pickTextFile } from "./files";
import { useKeyboardShortcuts } from "./shortcuts";
import { HANDOFF_REQUEST, decideDragEnd, handoffIdFromLocation, handoffPayloadEvent, openWorkspaceWindow, takeBrowserHandoff, type WorkspaceHandoff } from "./detach";
import { serializeTerminal } from "./terminalRegistry";
import { defaultTheme } from "./themes";
import { MachineEditor } from "./components/MachineEditor";
import { TerminalPane } from "./components/TerminalPane";
import { SettingsPanel } from "./components/SettingsPanel";
import { Modal } from "./components/Modal";
import { ToastHost } from "./components/ToastHost";
import { showToast } from "./toast";

interface Workspace { id: string; name: string; sessions: SessionSummary[] }
interface ConnectTarget { splitWorkspaceId?: string; replaceSessionId?: string }
interface PendingLogin { profile: MachineProfile; target?: ConnectTarget }
interface ConfirmRequest { message: string; confirmLabel: string; danger: boolean; resolve: (ok: boolean) => void }

function workspaceStatus(sessions: SessionSummary[]): "connected" | "connecting" | "failed" | "disconnected" {
  if (sessions.some((session) => session.status === "connected")) return "connected";
  if (sessions.some((session) => session.status === "connecting" || session.status === "authenticating" || session.status === "verifying_host")) return "connecting";
  if (sessions.some((session) => session.status === "failed")) return "failed";
  return "disconnected";
}
type MainView = "machines" | "settings";
const DATA_CHANGED = "sesh:data-changed";
const bootHandoffId = handoffIdFromLocation(window.location.search);

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
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest>();
  // Stable identity so the mount effect can use it without stale closures.
  const askConfirm = useRef((message: string, confirmLabel = "Confirm", danger = false) =>
    new Promise<boolean>((resolve) => setConfirmReq({ message, confirmLabel, danger, resolve }))).current;
  const workspacesRef = useRef<Workspace[]>([]);
  const settingsRef = useRef<AppSettings>(DEFAULT_APP_SETTINGS);
  const pendingHandoffs = useRef(new Map<string, string>());
  const initialContentRef = useRef<Record<string, string>>({});
  const dragPointerInside = useRef(true);
  const positionsReliable = useRef(false);
  useEffect(() => { workspacesRef.current = workspaces; }, [workspaces]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const globalTheme = themes.find((theme) => theme.id === settings.globalThemeId) || themes[0] || defaultTheme;
  const active = workspaces.find((workspace) => workspace.id === activeWorkspace);
  const refresh = async () => {
    const [nextProfiles, nextThemes, nextSettings] = await Promise.all([api.listProfiles(), api.listThemes(), api.getSettings()]);
    setProfiles(nextProfiles); setThemes(nextThemes); setSettings(nextSettings); setLoading(false);
  };
  const adoptHandoff = (payload: WorkspaceHandoff) => {
    initialContentRef.current = payload.serialized;
    setView("machines"); setWorkspaces([payload.workspace]); setActiveWorkspace(payload.workspace.id);
  };
  useEffect(() => {
    void refresh();
    void api.windowPositioningReliable().then((reliable) => { positionsReliable.current = reliable; });
    let cancelled = false;
    const offs: Array<() => void> = [];
    // If the component unmounts before a listener registration resolves, the
    // unlisten must still run or the underlying Tauri listener leaks.
    const on = (registration: Promise<() => void>) => registration.then((off) => { if (cancelled) off(); else offs.push(off); });
    let lastTransportState: string | undefined;
    offs.push(api.onTransportState((state) => {
      if (state === "down") showToast("error", "Terminal connection lost. Type in a terminal or reconnect to retry.");
      else if (state === "connected" && lastTransportState === "down") showToast("success", "Terminal connection restored.");
      lastTransportState = state;
    }));
    on(api.onStatus((next) => setWorkspaces((all) => all.map((workspace) => ({ ...workspace, sessions: workspace.sessions.map((session) => session.id === next.id ? { ...session, ...next } : session) })))));
    on(api.onHostKey((challenge) => { if (!challenge.windowLabel || challenge.windowLabel === api.windowLabel()) setHostKey(challenge); }));
    on(api.onAppEvent(DATA_CHANGED, () => void refresh()));
    // Another window asked to adopt one of our workspaces: snapshot its panes,
    // hand them over, then drop the tab here without disconnecting anything.
    on(api.onAppEvent<{ handoffId: string }>(HANDOFF_REQUEST, (request) => {
      const workspaceId = pendingHandoffs.current.get(request.handoffId);
      console.log("[detach] handoff requested", request.handoffId, "pending here:", !!workspaceId);
      if (!workspaceId) return;
      pendingHandoffs.current.delete(request.handoffId);
      const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
      if (!workspace) return;
      const serialized: Record<string, string> = {};
      for (const session of workspace.sessions) { const snapshot = serializeTerminal(session.id); if (snapshot) serialized[session.id] = snapshot; }
      void api.emitAppEvent(handoffPayloadEvent(request.handoffId), { workspace, serialized } satisfies WorkspaceHandoff);
      setWorkspaces((all) => all.filter((item) => item.id !== workspace.id));
      setActiveWorkspace((current) => current === workspace.id ? null : current);
    }));
    on(api.onCloseRequested(async (event) => {
      const sessions = workspacesRef.current.flatMap((workspace) => workspace.sessions);
      const live = sessions.filter((session) => session.status === "connected");
      // Tauri awaits this handler before deciding whether to close, so the
      // themed confirm can resolve before preventDefault is evaluated.
      if (settingsRef.current.confirmCloseSessions && live.length && !(await askConfirm(`Close this window and disconnect ${live.length} live ${live.length === 1 ? "session" : "sessions"}?`, "Close window"))) { event.preventDefault(); return; }
      await Promise.all(sessions.map((session) => api.disconnect(session.id).catch(() => {})));
    }));
    if (bootHandoffId) {
      if (api.isNative()) {
        let adopted = false;
        console.log("[detach] child booting with handoff", bootHandoffId);
        on(api.onAppEvent<WorkspaceHandoff>(handoffPayloadEvent(bootHandoffId), (payload) => { if (!adopted) { adopted = true; console.log("[detach] child received payload"); adoptHandoff(payload); } })
          .then((off) => { void api.emitAppEvent(HANDOFF_REQUEST, { handoffId: bootHandoffId }); return off; }));
      } else {
        const payload = takeBrowserHandoff(bootHandoffId);
        if (payload) adoptHandoff(payload);
      }
    }
    const dragInside = () => { dragPointerInside.current = true; };
    const dragLeave = (event: DragEvent) => { if (!event.relatedTarget) dragPointerInside.current = false; };
    window.addEventListener("dragenter", dragInside, true);
    window.addEventListener("dragover", dragInside, true);
    window.addEventListener("drop", dragInside, true);
    window.addEventListener("dragleave", dragLeave, true);
    offs.push(() => { window.removeEventListener("dragenter", dragInside, true); window.removeEventListener("dragover", dragInside, true); window.removeEventListener("drop", dragInside, true); window.removeEventListener("dragleave", dragLeave, true); });
    return () => { cancelled = true; for (const off of offs) off(); };
  }, []);
  const detachWorkspace = async (workspace: Workspace, position?: { x: number; y: number }) => {
    const handoffId = crypto.randomUUID();
    if (api.isNative()) {
      pendingHandoffs.current.set(handoffId, workspace.id);
      await openWorkspaceWindow(handoffId, workspace.name, position);
      return;
    }
    const serialized: Record<string, string> = {};
    for (const session of workspace.sessions) { const snapshot = serializeTerminal(session.id); if (snapshot) serialized[session.id] = snapshot; }
    await openWorkspaceWindow(handoffId, workspace.name, position, { workspace, serialized });
    setWorkspaces((all) => all.filter((item) => item.id !== workspace.id));
    setActiveWorkspace((current) => current === workspace.id ? null : current);
  };

  const filtered = useMemo(() => profiles.filter((profile) => `${profile.name} ${profile.host} ${profile.username}`.toLowerCase().includes(query.toLowerCase())), [profiles, query]);
  const dataChanged = () => void api.emitAppEvent(DATA_CHANGED);
  const saveProfile = async (draft: MachineDraft) => { await api.saveProfile(draft); setEditor(null); await refresh(); dataChanged(); };
  const removeProfile = async (profile: MachineProfile) => { if (!(await askConfirm(`Delete ${profile.name}? Saved credentials for this machine will also be removed.`, "Delete", true))) return; await api.deleteProfile(profile.id); await refresh(); dataChanged(); };
  const beginConnect = (profile: MachineProfile, target?: ConnectTarget) => {
    if ((profile.authKind === "password" && !profile.hasSavedPassword) || (profile.authKind === "privateKey" && !profile.hasSavedPassphrase)) setPending({ profile, target });
    else void connect(profile, target);
  };
  const connect = async (profile: MachineProfile, target?: ConnectTarget, secret?: string) => {
    setPending(undefined); setSplitPicker(false);
    try {
      const session = await api.connect(profile.id, profile.authKind === "password" ? secret : undefined, profile.authKind === "privateKey" ? secret : undefined);
      setView("machines");
      const { splitWorkspaceId, replaceSessionId } = target ?? {};
      // Reconnect swaps the dead pane for the new session in place; the pane
      // is keyed by session id, so it remounts cleanly without duplicating.
      if (splitWorkspaceId && replaceSessionId) setWorkspaces((all) => all.map((workspace) => workspace.id === splitWorkspaceId ? { ...workspace, sessions: workspace.sessions.map((existing) => existing.id === replaceSessionId ? session : existing) } : workspace));
      else if (splitWorkspaceId) setWorkspaces((all) => all.map((workspace) => workspace.id === splitWorkspaceId ? { ...workspace, sessions: [...workspace.sessions, session] } : workspace));
      else { const id = crypto.randomUUID(); setWorkspaces((all) => [...all, { id, name: profile.name, sessions: [session] }]); if (settings.focusNewSessions) setActiveWorkspace(id); }
    } catch (error) {
      showToast("error", `Could not connect to ${profile.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const closeSession = async (workspaceId: string, session: SessionSummary) => {
    if (settings.confirmCloseSessions && session.status === "connected" && !(await askConfirm(`Close the live ${session.profileName} session?`, "Close session"))) return;
    await api.disconnect(session.id);
    setWorkspaces((all) => all.flatMap((workspace) => { if (workspace.id !== workspaceId) return [workspace]; const sessions = workspace.sessions.filter((item) => item.id !== session.id); return sessions.length ? [{ ...workspace, sessions }] : []; }));
  };
  const closeWorkspace = async (workspace: Workspace) => {
    if (settings.confirmCloseSessions && workspace.sessions.some((session) => session.status === "connected") && !(await askConfirm(`Close ${workspace.name} and disconnect its live sessions?`, "Close workspace"))) return;
    await Promise.all(workspace.sessions.map((session) => api.disconnect(session.id)));
    setWorkspaces((all) => all.filter((item) => item.id !== workspace.id));
    if (activeWorkspace === workspace.id) setActiveWorkspace(null);
  };
  const importMachines = async () => {
    const file = await pickTextFile(".json");
    if (!file) return;
    const result = parseMachineImport(file.text);
    if ("error" in result) { showToast("error", result.error); return; }
    const existing = new Set(profiles.map((profile) => `${profile.name}\0${profile.host}\0${profile.port}\0${profile.username}`));
    let imported = 0, skipped = 0;
    try {
      for (const draft of result.drafts) {
        const key = `${draft.name}\0${draft.host}\0${draft.port}\0${draft.username}`;
        if (existing.has(key)) { skipped++; continue; }
        await api.saveProfile(draft);
        existing.add(key);
        imported++;
      }
    } catch (error) {
      showToast("error", `Import stopped: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (imported || skipped) {
      await refresh(); dataChanged();
      showToast(imported ? "success" : "info", `Imported ${imported} ${imported === 1 ? "machine" : "machines"}${skipped ? ` (${skipped} skipped as duplicates)` : ""}.`);
    }
  };
  const exportMachine = (profile: MachineProfile) => downloadJson(`${profile.name.toLowerCase().replace(/\W+/g, "-")}.sesh-machines.json`, serializeMachineExport([profile]));
  useKeyboardShortcuts((action) => {
    switch (action.kind) {
      case "next-tab":
      case "prev-tab": {
        if (!workspaces.length) return;
        const index = workspaces.findIndex((workspace) => workspace.id === activeWorkspace);
        const delta = action.kind === "next-tab" ? 1 : -1;
        const next = index === -1
          ? (delta === 1 ? workspaces[0] : workspaces[workspaces.length - 1])
          : workspaces[(index + delta + workspaces.length) % workspaces.length];
        setView("machines"); setActiveWorkspace(next.id);
        return;
      }
      case "tab-index": {
        const target = workspaces[action.index];
        if (target) { setView("machines"); setActiveWorkspace(target.id); }
        return;
      }
      case "close-workspace": if (active) void closeWorkspace(active); return;
      case "new-connection": setEditor("new"); return;
    }
  });
  const saveTheme = async (theme: ThemeDefinition) => { const saved = await api.saveTheme(theme); setThemes(await api.listThemes()); if (!theme.builtIn) await selectTheme(saved.id); else dataChanged(); };
  const saveSettings = async (next: AppSettings) => { setSettings(await api.saveSettings(next)); dataChanged(); };
  const selectTheme = async (id: string) => saveSettings({ ...settings, globalThemeId: id });
  const showMachines = () => { setView("machines"); setActiveWorkspace(null); };

  return <div className="app-shell" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => event.preventDefault()}>
    <aside className="app-rail">
      <button className="rail-brand" title="Sesh" onClick={showMachines}>$</button>
      <button className={view === "machines" && !active ? "active" : ""} onClick={showMachines}><LayoutDashboard size={19}/><span>Machines</span></button>
      <div className="rail-spacer"/>
      <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><Settings size={19}/><span>Settings</span></button>
    </aside>
    <div className="app-main">
      <header className="titlebar">
        <div className="page-context">{view === "settings" ? <><Settings size={15}/>Settings</> : active ? <><TerminalSquare size={15}/>{active.name}</> : <><LayoutDashboard size={15}/>Machines</>}</div>
        <nav className="workspace-tabs">{workspaces.map((workspace) => <button key={workspace.id} className={view === "machines" && activeWorkspace === workspace.id ? "active" : ""} title={workspace.name} onClick={() => { setView("machines"); setActiveWorkspace(workspace.id); }} onAuxClick={(event) => { if (event.button === 1) void closeWorkspace(workspace); }} draggable onDragStart={(event) => { event.dataTransfer.setData("application/x-sesh-workspace", workspace.id); event.dataTransfer.effectAllowed = "move"; dragPointerInside.current = true; event.currentTarget.classList.add("dragging"); }} onDragEnd={(event) => { event.currentTarget.classList.remove("dragging"); const bounds = positionsReliable.current ? { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight } : undefined; const decision = decideDragEnd({ pointerInside: dragPointerInside.current, screenX: event.screenX, screenY: event.screenY, windowBounds: bounds }); console.log("[detach] dragend", { decision, pointerInside: dragPointerInside.current, event: [event.screenX, event.screenY], windowScreen: [window.screenX, window.screenY], outer: [window.outerWidth, window.outerHeight] }); if (decision === "detach") detachWorkspace(workspace, bounds ? { x: event.screenX, y: event.screenY } : undefined).catch((error) => console.error("[detach] failed", error)); }}><span className={`status-dot ${workspaceStatus(workspace.sessions)}`}/>{workspace.name}<span className="tab-close" role="button" tabIndex={0} aria-label={`Close ${workspace.name}`} onClick={(event) => { event.stopPropagation(); void closeWorkspace(workspace); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); void closeWorkspace(workspace); } }}><X size={13}/></span></button>)}</nav>
      </header>
      {view === "settings" ? <SettingsPanel settings={settings} themes={themes} onSaveSettings={saveSettings} onSelectTheme={selectTheme} onSaveTheme={saveTheme} onDeleteTheme={async (id) => { await api.deleteTheme(id); const next = await api.listThemes(); setThemes(next); if (id === settings.globalThemeId) await selectTheme(defaultTheme.id); else dataChanged(); }}/>
      : !active ? <main className="dashboard">
        <div className="dashboard-tools"><div className="search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search machines, hosts, or users…"/></div><span className="machine-count">{profiles.length} {profiles.length === 1 ? "machine" : "machines"}</span><button className="icon-button" title="Import machines from JSON" aria-label="Import machines" onClick={() => void importMachines()}><Upload size={16}/></button><button className="icon-button" title="Export all machines (no secrets)" aria-label="Export machines" disabled={!profiles.length} onClick={() => downloadJson("sesh-machines.json", serializeMachineExport(profiles))}><Download size={16}/></button><button className="button primary" onClick={() => setEditor("new")}><Plus size={17}/>Add machine</button></div>
        {loading ? <div className="empty"><span className="spinner"/><p>Loading machines…</p></div> : filtered.length ? <div className="machine-grid">{filtered.map((profile) => <MachineCard key={profile.id} profile={profile} theme={themes.find((theme) => theme.id === profile.themeId) || globalTheme} onConnect={() => beginConnect(profile)} onEdit={() => setEditor(profile)} onExport={() => exportMachine(profile)} onDelete={() => removeProfile(profile)}/>)}</div> : profiles.length ? <div className="empty"><Search/><h2>No machines found</h2><p>Try a different search.</p></div> : <div className="empty empty-card"><div className="empty-icon"><TerminalSquare/></div><h2>Your next session starts here</h2><p>Add a server, development box, or Raspberry Pi. Credentials can stay in your operating system’s secure vault.</p><button className="button primary" onClick={() => setEditor("new")}><Plus size={17}/>Add your first machine</button></div>}
      </main>
      : <main className="workspace"><div className="workspace-toolbar"><div><TerminalSquare size={17}/><strong>{active.name}</strong><span>{active.sessions.length} {active.sessions.length === 1 ? "pane" : "panes"}</span></div><button className="button secondary compact" onClick={() => setSplitPicker(true)}><SplitSquareHorizontal size={16}/>Split session</button></div><div className={`terminal-grid panes-${Math.min(active.sessions.length, 4)}`}>{active.sessions.map((session) => <TerminalPane key={session.id} session={session} theme={themes.find((theme) => theme.id === profiles.find((profile) => profile.id === session.profileId)?.themeId) || globalTheme} initialContent={initialContentRef.current[session.id]} onClose={() => closeSession(active.id, session)} onReconnect={() => { const profile = profiles.find((item) => item.id === session.profileId); if (profile) beginConnect(profile, { splitWorkspaceId: active.id, replaceSessionId: session.id }); }}/>)}</div></main>}
    </div>
    {editor && <MachineEditor profile={editor === "new" ? undefined : editor} themes={themes} defaultPort={settings.defaultPort} onSave={saveProfile} onClose={() => setEditor(null)}/>} 
    {pending && <SecretPrompt pending={pending} onClose={() => setPending(undefined)} onConnect={(secret) => void connect(pending.profile, pending.target, secret)}/>}
    {splitPicker && active && <Modal title="Choose a machine for this split" onClose={() => setSplitPicker(false)}>{profiles.length ? <div className="picker-list">{profiles.map((profile) => <button key={profile.id} onClick={() => beginConnect(profile, { splitWorkspaceId: active.id })}><Server size={18}/><span><strong>{profile.name}</strong><small>{profile.username}@{profile.host}</small></span></button>)}</div> : <div className="empty"><Server/><h2>No machines yet</h2><p>Add a machine to open it in a split pane.</p><button className="button primary" onClick={() => { setSplitPicker(false); setEditor("new"); }}><Plus size={17}/>Add machine</button></div>}</Modal>}
    {hostKey && <HostKeyModal challenge={hostKey} onDone={async (approve) => {
      // A "changed" challenge is informational only — the backend already
      // rejected the connection and holds no pending approval to answer.
      try { if (hostKey.kind === "new") await api.approveHostKey(hostKey.sessionId, approve); }
      catch (error) { showToast("error", error instanceof Error ? error.message : String(error)); }
      finally { setHostKey(undefined); }
    }}/>}
    {confirmReq && <ConfirmModal request={confirmReq} onDone={(ok) => { confirmReq.resolve(ok); setConfirmReq(undefined); }}/>}
    <ToastHost/>
  </div>;
}

function ConfirmModal({ request, onDone }: { request: ConfirmRequest; onDone: (ok: boolean) => void }) {
  return <Modal title="Are you sure?" onClose={() => onDone(false)}>
    <div className="form-stack">
      <p className="muted">{request.message}</p>
      <footer className="modal-actions">
        <button autoFocus className="button secondary" onClick={() => onDone(false)}>Cancel</button>
        <button className={`button ${request.danger ? "danger" : "primary"}`} onClick={() => onDone(true)}>{request.confirmLabel}</button>
      </footer>
    </div>
  </Modal>;
}

function MachineCard({ profile, theme, onConnect, onEdit, onExport, onDelete }: { profile: MachineProfile; theme: ThemeDefinition; onConnect: () => void; onEdit: () => void; onExport: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onPress = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", onPress);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPress); document.removeEventListener("keydown", onKey); };
  }, [menu]);
  const item = (action: () => void) => (event: React.MouseEvent) => { event.stopPropagation(); setMenu(false); action(); };
  return <article className={`machine-card${menu ? " menu-open" : ""}`} role="button" tabIndex={0} onClick={onConnect} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); onConnect(); } }}>
    <div className="machine-accent" style={{ background: theme.palette.ansi[4] }}/>
    <div className="machine-top">
      <div className="machine-icon" style={{ color: theme.palette.ansi[4], background: `${theme.palette.ansi[4]}18` }}><Server size={20}/></div>
      <div className="card-menu" ref={menuRef}>
        <button className="icon-button" aria-label={`Options for ${profile.name}`} aria-expanded={menu} onClick={(event) => { event.stopPropagation(); setMenu(!menu); }}><MoreVertical size={17}/></button>
        {menu && <div className="menu">
          <button onClick={item(onEdit)}><Edit3 size={14}/>Edit</button>
          <button onClick={item(onExport)}><Download size={14}/>Export</button>
          <button className="danger-text" onClick={item(onDelete)}><Trash2 size={14}/>Delete</button>
        </div>}
      </div>
    </div>
    <h2>{profile.name}</h2>
    <p className="machine-address">{profile.username}@{profile.host}{profile.port !== 22 ? `:${profile.port}` : ""}</p>
    <div className="machine-meta"><span><KeyRound size={14}/>{profile.authKind === "privateKey" ? "Private key" : "Password"}</span>{profile.lastConnectedAt && <span>Recent</span>}</div>
    <button className="connect-button"><Wifi size={15}/>Connect<span>↗</span></button>
  </article>;
}
function SecretPrompt({ pending, onClose, onConnect }: { pending: PendingLogin; onClose: () => void; onConnect: (secret: string) => void }) { const [secret, setSecret] = useState(""); return <Modal title={`Connect to ${pending.profile.name}`} onClose={onClose}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onConnect(secret); }}><p className="muted">Enter the {pending.profile.authKind === "password" ? "SSH password" : "private-key passphrase"} for <strong>{pending.profile.username}@{pending.profile.host}</strong>.</p><div className="field"><label>{pending.profile.authKind === "password" ? "Password" : "Passphrase"}</label><input autoFocus type="password" value={secret} onChange={(event) => setSecret(event.target.value)}/></div><footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary">Connect</button></footer></form></Modal>; }
function HostKeyModal({ challenge, onDone }: { challenge: HostKeyChallenge; onDone: (approve: boolean) => void }) { return <Modal title={challenge.kind === "changed" ? "Host identity changed" : "Trust this host?"} onClose={() => onDone(false)}><div className="host-key"><div className={challenge.kind === "changed" ? "warning-icon danger" : "warning-icon"}><KeyRound/></div><p>{challenge.kind === "changed" ? "The key presented by this server does not match the saved key. This can indicate an attack or a reinstalled server, so the connection was refused. If this change is expected, remove this host's entry from sesh's known_hosts file and reconnect." : "Verify this fingerprint with the server administrator before continuing."}</p><dl><dt>Host</dt><dd>{challenge.host}:{challenge.port}</dd><dt>Algorithm</dt><dd>{challenge.algorithm}</dd><dt>Fingerprint</dt><dd><code>{challenge.fingerprint}</code></dd></dl><footer className="modal-actions"><button className="button secondary" onClick={() => onDone(false)}>Cancel connection</button>{challenge.kind === "new" && <button className="button primary" onClick={() => onDone(true)}>Trust and connect</button>}</footer></div></Modal>; }
