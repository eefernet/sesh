import { useState } from "react";
import { Eye, EyeOff, FolderOpen, KeyRound, LockKeyhole, Server } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import type { MachineDraft, MachineProfile, ThemeDefinition } from "../domain";
import { emptyDraft, validateMachine } from "../domain";
import { api } from "../api";
import { Modal } from "./Modal";

export function MachineEditor({ profile, themes, defaultPort, onSave, onClose }: { profile?: MachineProfile; themes: ThemeDefinition[]; defaultPort: number; onSave: (d: MachineDraft) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState<MachineDraft>(profile ? { ...profile, savePassword: profile.hasSavedPassword, savePassphrase: profile.hasSavedPassphrase } : emptyDraft(defaultPort));
  const [errors, setErrors] = useState<Record<string,string>>({}); const [showSecret, setShowSecret] = useState(false); const [busy, setBusy] = useState(false);
  const set = <K extends keyof MachineDraft>(key: K, value: MachineDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const chooseKey = async () => { if (!api.isNative()) return; const path = await open({ multiple: false, directory: false, title: "Choose an SSH private key" }); if (path) set("privateKeyPath", path); };
  const submit = async (e: React.FormEvent) => { e.preventDefault(); const next = validateMachine(draft); setErrors(next); if (Object.keys(next).length) return; setBusy(true); try { await onSave(draft); } finally { setBusy(false); } };
  return <Modal title={profile ? "Edit machine" : "Add a machine"} onClose={onClose}>
    <form onSubmit={submit} className="form-stack">
      <div className="field"><label>Display name</label><div className="input-wrap"><Server size={17}/><input autoFocus value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Production server"/></div>{errors.name && <small className="error">{errors.name}</small>}</div>
      <div className="field-grid host-grid"><div className="field"><label>Hostname or IP</label><input value={draft.host} onChange={(e) => set("host", e.target.value)} placeholder="192.168.1.20"/>{errors.host && <small className="error">{errors.host}</small>}</div><div className="field"><label>Port</label><input type="number" value={draft.port} onChange={(e) => set("port", Number(e.target.value))}/>{errors.port && <small className="error">{errors.port}</small>}</div></div>
      <div className="field"><label>Username</label><input value={draft.username} onChange={(e) => set("username", e.target.value)} placeholder="admin"/>{errors.username && <small className="error">{errors.username}</small>}</div>
      <div className="field"><label>Authentication</label><div className="segmented"><button type="button" className={draft.authKind === "password" ? "active" : ""} onClick={() => set("authKind", "password")}><LockKeyhole size={16}/>Password</button><button type="button" className={draft.authKind === "privateKey" ? "active" : ""} onClick={() => set("authKind", "privateKey")}><KeyRound size={16}/>Private key</button></div></div>
      {draft.authKind === "password" ? <div className="field"><label>Password <span>optional until connect</span></label><div className="input-wrap"><input type={showSecret ? "text" : "password"} value={draft.password || ""} onChange={(e) => set("password", e.target.value)} placeholder={profile?.hasSavedPassword ? "Saved securely" : "Enter password"}/><button type="button" className="inline-icon" onClick={() => setShowSecret(!showSecret)}>{showSecret ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div><label className="check"><input type="checkbox" checked={draft.savePassword} onChange={(e) => set("savePassword", e.target.checked)}/> Save in the operating system credential vault</label></div> : <>
        <div className="field"><label>Private key</label><div className="input-wrap"><input value={draft.privateKeyPath || ""} onChange={(e) => set("privateKeyPath", e.target.value)} placeholder="~/.ssh/id_ed25519"/><button type="button" className="inline-icon" onClick={chooseKey}><FolderOpen size={16}/></button></div>{errors.privateKeyPath && <small className="error">{errors.privateKeyPath}</small>}</div>
        <div className="field"><label>Key passphrase <span>if encrypted</span></label><input type="password" value={draft.passphrase || ""} onChange={(e) => set("passphrase", e.target.value)} placeholder={profile?.hasSavedPassphrase ? "Saved securely" : "Optional"}/><label className="check"><input type="checkbox" checked={draft.savePassphrase} onChange={(e) => set("savePassphrase", e.target.checked)}/> Save in the operating system credential vault</label></div>
      </>}
      <div className="field"><label>Terminal theme</label><select value={draft.themeId || ""} onChange={(e) => set("themeId", e.target.value || undefined)}><option value="">Use global default</option>{themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      <footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save machine"}</button></footer>
    </form>
  </Modal>;
}
