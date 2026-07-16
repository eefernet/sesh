import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { SerializeAddon } from "@xterm/addon-serialize";
import { SearchAddon } from "@xterm/addon-search";
import { AlertCircle, ChevronDown, ChevronUp, LoaderCircle, RotateCcw, Search, X } from "lucide-react";
import type { SessionSummary, ThemeDefinition } from "../domain";
import { api } from "../api";
import { registerTerminal } from "../terminalRegistry";
import { resolveShortcut } from "../shortcuts";
import { debounceCall, dispatchTerminalInput, latencyTraceEnabled, traceLatency } from "../terminalTransport";

export function TerminalPane({ session, theme, initialContent, onClose, onReconnect }: { session: SessionSummary; theme: ThemeDefinition; initialContent?: string; onClose: () => void; onReconnect: () => void }) {
  const host = useRef<HTMLDivElement>(null); const terminal = useRef<Terminal | undefined>(undefined);
  const search = useRef<SearchAddon | undefined>(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({ allowProposedApi: false, convertEol: false, fontFamily: theme.fontFamily, fontSize: theme.fontSize, fontWeight: theme.fontWeight, lineHeight: theme.lineHeight, letterSpacing: theme.letterSpacing, cursorStyle: theme.cursorStyle, cursorBlink: theme.cursorBlink, scrollback: theme.scrollback, theme: xtermTheme(theme) });
    const fit = new FitAddon(); term.loadAddon(fit); term.loadAddon(new WebLinksAddon()); const serialize = new SerializeAddon(); term.loadAddon(serialize); const searchAddon = new SearchAddon(); term.loadAddon(searchAddon); search.current = searchAddon; term.open(host.current); try { if (localStorage.getItem("sesh.disableWebgl") !== "1") term.loadAddon(new WebglAddon()); } catch { /* canvas renderer */ }
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.ctrlKey && event.shiftKey && event.code === "KeyF") { setSearchOpen(true); return false; }
      // Global app shortcuts are handled by the window capture listener;
      // returning false here keeps xterm from also acting on them.
      if (event.type === "keydown" && resolveShortcut(event)) return false;
      return true;
    });
    if (initialContent) term.write(initialContent);
    // No explicit cap: the buffer is already bounded by the terminal's own
    // scrollback option, so tear-out carries exactly what the theme allows.
    const unregister = registerTerminal(session.id, () => serialize.serialize());
    requestAnimationFrame(() => { fit.fit(); void api.resize(session.id, term.cols, term.rows); term.focus(); }); terminal.current = term;
    const input = term.onData((data) => dispatchTerminalInput(api.sendInput, session.id, data));
    const traceKey = (event: KeyboardEvent) => traceLatency("key", event.key.length, event.timeStamp);
    const tracing = latencyTraceEnabled();
    if (tracing) host.current.addEventListener("keydown", traceKey, true);
    const paneHost = host.current;
    const resizeDispatch = debounceCall((cols: number, rows: number) => { void api.resize(session.id, cols, rows); }, 50);
    const resize = new ResizeObserver(() => { try { fit.fit(); resizeDispatch.schedule(term.cols, term.rows); } catch {} }); resize.observe(host.current);
    const write = tracing
      ? (data: Uint8Array) => term.write(data, () => requestAnimationFrame(() => traceLatency("fe-paint", data.length)))
      : (data: Uint8Array) => term.write(data);
    let cancelled = false;
    let offOutput = () => {};
    api.onOutput(session.id, write).then((off) => { if (cancelled) off(); else offOutput = off; });
    return () => { cancelled = true; unregister(); offOutput(); resize.disconnect(); resizeDispatch.cancel(); input.dispose(); paneHost.removeEventListener("keydown", traceKey, true); term.dispose(); terminal.current = undefined; search.current = undefined; };
  }, [session.id]);
  useEffect(() => { terminal.current?.options && Object.assign(terminal.current.options, { fontFamily: theme.fontFamily, fontSize: theme.fontSize, fontWeight: theme.fontWeight, lineHeight: theme.lineHeight, letterSpacing: theme.letterSpacing, cursorStyle: theme.cursorStyle, cursorBlink: theme.cursorBlink, scrollback: theme.scrollback, theme: xtermTheme(theme) }); }, [theme]);
  return <section className="terminal-pane" style={{ "--term-padding": `${theme.padding}px`, backgroundColor: theme.palette.background, backgroundImage: theme.backgroundImage ? `linear-gradient(rgba(0,0,0,${1-theme.backgroundImageOpacity}),rgba(0,0,0,${1-theme.backgroundImageOpacity})), url(${theme.backgroundImage})` : undefined } as React.CSSProperties}>
    <div className="pane-bar"><span className={`status-dot ${session.status}`}/><span>{session.profileName}</span><span className="pane-status">{session.status.replace("_", " ")}</span><button onClick={onClose} aria-label="Close terminal"><X size={15}/></button></div>
    {searchOpen && <TerminalSearchBar
      onFind={(query, mode) => { const addon = search.current; if (!addon || !query) return; if (mode === "prev") addon.findPrevious(query); else addon.findNext(query, { incremental: mode === "incremental" }); }}
      onClose={() => { setSearchOpen(false); terminal.current?.clearSelection(); terminal.current?.focus(); }}
    />}
    <div ref={host} className="terminal-host"/>
    {session.status !== "connected" && <div className="terminal-overlay">{session.status === "failed" ? <><AlertCircle/><strong>Connection failed</strong><p>{session.lastError}</p><button className="button primary" onClick={onReconnect}><RotateCcw size={16}/>Reconnect</button></> : session.status === "disconnected" ? <><AlertCircle/><strong>Session ended</strong><button className="button primary" onClick={onReconnect}><RotateCcw size={16}/>Reconnect</button></> : <><LoaderCircle className="spin"/><strong>{session.status.replace("_", " ")}…</strong></>}</div>}
  </section>;
}
function TerminalSearchBar({ onFind, onClose }: { onFind: (query: string, mode: "incremental" | "next" | "prev") => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  return <div className="terminal-search" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <Search size={13}/>
    <input autoFocus value={query} placeholder="Find…" aria-label="Find in terminal"
      onChange={(event) => { setQuery(event.target.value); onFind(event.target.value, "incremental"); }}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onFind(query, event.shiftKey ? "prev" : "next"); } }}/>
    <button className="icon-button" aria-label="Previous match" onClick={() => onFind(query, "prev")}><ChevronUp size={14}/></button>
    <button className="icon-button" aria-label="Next match" onClick={() => onFind(query, "next")}><ChevronDown size={14}/></button>
    <button className="icon-button" aria-label="Close search" onClick={onClose}><X size={14}/></button>
  </div>;
}
function xtermTheme(theme: ThemeDefinition) { return { ...theme.palette, background: withOpacity(theme.palette.background, theme.backgroundOpacity), black: theme.palette.ansi[0], red: theme.palette.ansi[1], green: theme.palette.ansi[2], yellow: theme.palette.ansi[3], blue: theme.palette.ansi[4], magenta: theme.palette.ansi[5], cyan: theme.palette.ansi[6], white: theme.palette.ansi[7], brightBlack: theme.palette.ansi[8], brightRed: theme.palette.ansi[9], brightGreen: theme.palette.ansi[10], brightYellow: theme.palette.ansi[11], brightBlue: theme.palette.ansi[12], brightMagenta: theme.palette.ansi[13], brightCyan: theme.palette.ansi[14], brightWhite: theme.palette.ansi[15] }; }
function withOpacity(hex: string, opacity: number) { if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex; return `${hex}${Math.round(opacity * 255).toString(16).padStart(2,"0")}`; }
