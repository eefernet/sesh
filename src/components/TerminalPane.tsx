import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { AlertCircle, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { SessionSummary, ThemeDefinition } from "../domain";
import { api } from "../api";
import { debounceCall, dispatchTerminalInput, latencyTraceEnabled, traceLatency } from "../terminalTransport";

export function TerminalPane({ session, theme, onClose, onReconnect }: { session: SessionSummary; theme: ThemeDefinition; onClose: () => void; onReconnect: () => void }) {
  const host = useRef<HTMLDivElement>(null); const terminal = useRef<Terminal | undefined>(undefined);
  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({ allowProposedApi: false, convertEol: false, fontFamily: theme.fontFamily, fontSize: theme.fontSize, fontWeight: theme.fontWeight, lineHeight: theme.lineHeight, letterSpacing: theme.letterSpacing, cursorStyle: theme.cursorStyle, cursorBlink: theme.cursorBlink, scrollback: theme.scrollback, theme: xtermTheme(theme) });
    const fit = new FitAddon(); term.loadAddon(fit); term.loadAddon(new WebLinksAddon()); term.open(host.current); try { if (localStorage.getItem("sesh.disableWebgl") !== "1") term.loadAddon(new WebglAddon()); } catch { /* canvas renderer */ }
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
    let offOutput = () => {}; api.onOutput(session.id, write).then((off) => offOutput = off);
    return () => { offOutput(); resize.disconnect(); resizeDispatch.cancel(); input.dispose(); paneHost.removeEventListener("keydown", traceKey, true); term.dispose(); terminal.current = undefined; };
  }, [session.id]);
  useEffect(() => { terminal.current?.options && Object.assign(terminal.current.options, { fontFamily: theme.fontFamily, fontSize: theme.fontSize, fontWeight: theme.fontWeight, lineHeight: theme.lineHeight, letterSpacing: theme.letterSpacing, cursorStyle: theme.cursorStyle, cursorBlink: theme.cursorBlink, scrollback: theme.scrollback, theme: xtermTheme(theme) }); }, [theme]);
  return <section className="terminal-pane" style={{ "--term-padding": `${theme.padding}px`, "--term-opacity": theme.backgroundOpacity, backgroundColor: theme.palette.background, backgroundImage: theme.backgroundImage ? `linear-gradient(rgba(0,0,0,${1-theme.backgroundImageOpacity}),rgba(0,0,0,${1-theme.backgroundImageOpacity})), url(${theme.backgroundImage})` : undefined } as React.CSSProperties}>
    <div className="pane-bar"><span className={`status-dot ${session.status}`}/><span>{session.profileName}</span><span className="pane-status">{session.status.replace("_", " ")}</span><button onClick={onClose} aria-label="Close terminal"><X size={15}/></button></div>
    <div ref={host} className="terminal-host"/>
    {session.status !== "connected" && <div className="terminal-overlay">{session.status === "failed" ? <><AlertCircle/><strong>Connection failed</strong><p>{session.lastError}</p><button className="button primary" onClick={onReconnect}><RotateCcw size={16}/>Reconnect</button></> : session.status === "disconnected" ? <><AlertCircle/><strong>Session ended</strong><button className="button primary" onClick={onReconnect}><RotateCcw size={16}/>Reconnect</button></> : <><LoaderCircle className="spin"/><strong>{session.status.replace("_", " ")}…</strong></>}</div>}
  </section>;
}
function xtermTheme(theme: ThemeDefinition) { return { ...theme.palette, background: withOpacity(theme.palette.background, theme.backgroundOpacity), black: theme.palette.ansi[0], red: theme.palette.ansi[1], green: theme.palette.ansi[2], yellow: theme.palette.ansi[3], blue: theme.palette.ansi[4], magenta: theme.palette.ansi[5], cyan: theme.palette.ansi[6], white: theme.palette.ansi[7], brightBlack: theme.palette.ansi[8], brightRed: theme.palette.ansi[9], brightGreen: theme.palette.ansi[10], brightYellow: theme.palette.ansi[11], brightBlue: theme.palette.ansi[12], brightMagenta: theme.palette.ansi[13], brightCyan: theme.palette.ansi[14], brightWhite: theme.palette.ansi[15] }; }
function withOpacity(hex: string, opacity: number) { if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex; return `${hex}${Math.round(opacity * 255).toString(16).padStart(2,"0")}`; }
