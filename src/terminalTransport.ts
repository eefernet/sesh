import { invoke } from "@tauri-apps/api/core";

export interface DebouncedCall<T extends unknown[]> {
  schedule: (...args: T) => void;
  cancel: () => void;
}

export function debounceCall<T extends unknown[]>(callback: (...args: T) => void, delayMs: number): DebouncedCall<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule: (...args) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; callback(...args); }, delayMs);
    },
    cancel: () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; },
  };
}

interface TransportInfo { port: number; token: string; protocolVersion: number }
type OutputListener = (data: Uint8Array) => void;

// Stage timestamps for chasing per-keystroke latency. Off unless
// localStorage["sesh.traceLatency"] === "1" when the module loads.
export const latencyTraceEnabled = (): boolean => {
  try { return localStorage.getItem("sesh.traceLatency") === "1"; } catch { return false; }
};

export function traceLatency(stage: string, bytes: number, at = performance.now()): void {
  if (latencyTraceEnabled()) console.log("[lat]", stage, `${at.toFixed(1)}ms`, `${bytes}B`);
}

const INPUT = 1;
const RESIZE = 2;

function sessionBytes(id: string): Uint8Array {
  const hex = id.replaceAll("-", "");
  if (hex.length !== 32) throw new Error("Invalid session id");
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function sessionId(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function inputFrame(id: string, data: string): Uint8Array {
  const payload = new TextEncoder().encode(data);
  const frame = new Uint8Array(17 + payload.length);
  frame[0] = INPUT; frame.set(sessionBytes(id), 1); frame.set(payload, 17);
  return frame;
}

export function resizeFrame(id: string, cols: number, rows: number): Uint8Array {
  const frame = new Uint8Array(25); frame[0] = RESIZE; frame.set(sessionBytes(id), 1);
  const view = new DataView(frame.buffer); view.setUint32(17, cols); view.setUint32(21, rows);
  return frame;
}

export type TransportState = "connected" | "reconnecting" | "down";
type StateListener = (state: TransportState) => void;

const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_PENDING_FRAMES = 256;

interface TransportDeps {
  createSocket?: (url: string) => WebSocket;
  fetchInfo?: () => Promise<TransportInfo>;
}

export class NativeTerminalTransport {
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private info?: TransportInfo;
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private down = false;
  private listeners = new Map<string, Set<OutputListener>>();
  private stateListeners = new Set<StateListener>();
  // Frames sent before the socket opens wait here so keystrokes are neither
  // dropped nor reordered by racing individual connect() promises.
  private pending: Uint8Array[] = [];
  private readonly createSocket: (url: string) => WebSocket;
  private readonly fetchInfo: () => Promise<TransportInfo>;

  constructor(deps: TransportDeps = {}) {
    this.createSocket = deps.createSocket ?? ((url) => new WebSocket(url));
    this.fetchInfo = deps.fetchInfo ?? (() => invoke<TransportInfo>("terminal_transport_info"));
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  }

  private setState(state: TransportState) {
    this.down = state === "down";
    this.stateListeners.forEach((listener) => listener(state));
  }

  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;
    // Reviving a transport that gave up starts a fresh backoff run.
    if (this.down) { this.attempts = 0; this.down = false; }
    this.connecting = this.open().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private async open(): Promise<void> {
    this.info ??= await this.fetchInfo();
    if (this.info.protocolVersion !== 1) throw new Error("Unsupported terminal transport version");
    await new Promise<void>((resolve, reject) => {
      const socket = this.createSocket(`ws://127.0.0.1:${this.info!.port}`);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        socket.send(this.info!.token);
        this.socket = socket;
        this.attempts = 0;
        this.setState("connected");
        this.flushPending();
        resolve();
      };
      socket.onerror = () => reject(new Error("Could not open the local terminal transport"));
      socket.onmessage = (event) => this.route(event.data);
      socket.onclose = () => { if (this.socket === socket) this.socket = undefined; this.reconnect(); };
    });
  }

  private flushPending() {
    const frames = this.pending;
    this.pending = [];
    for (const frame of frames) this.send(frame);
  }

  private reconnect() {
    if (this.retry || this.listeners.size === 0) return;
    if (this.attempts >= MAX_RECONNECT_ATTEMPTS) {
      // Give up for now, but visibly; the next send() or connect() retries.
      this.setState("down");
      return;
    }
    this.setState("reconnecting");
    const delay = Math.min(2000, 100 * 2 ** this.attempts++);
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect().catch(() => this.reconnect()); }, delay);
  }

  private route(value: unknown) {
    if (!(value instanceof ArrayBuffer)) return;
    const frame = new Uint8Array(value);
    if (frame.length < 16) return;
    const listeners = this.listeners.get(sessionId(frame.subarray(0, 16)));
    if (!listeners) return;
    const payload = frame.subarray(16);
    traceLatency("fe-recv", payload.length);
    listeners.forEach((listener) => listener(payload));
  }

  sendInput(id: string, data: string): void { traceLatency("fe-send", data.length); this.send(inputFrame(id, data)); }
  resize(id: string, cols: number, rows: number): void { this.send(resizeFrame(id, cols, rows)); }

  private send(frame: Uint8Array) {
    if (this.socket?.readyState === WebSocket.OPEN) { this.socket.send(frame); return; }
    if (this.pending.length >= MAX_PENDING_FRAMES) {
      this.pending.shift();
      console.warn("[transport] pending frame queue full; dropped the oldest frame");
    }
    this.pending.push(frame);
    this.connect().catch((error) => console.error("[transport]", error));
  }

  subscribe(id: string, listener: OutputListener): () => void {
    const listeners = this.listeners.get(id) ?? new Set<OutputListener>();
    listeners.add(listener); this.listeners.set(id, listeners); void this.connect().catch((error) => console.error("[transport]", error));
    return () => { listeners.delete(listener); if (listeners.size === 0) this.listeners.delete(id); };
  }
}

export const nativeTerminalTransport = new NativeTerminalTransport();

export function dispatchTerminalInput(send: (sessionId: string, data: string) => unknown, sessionId: string, data: string): void {
  send(sessionId, data);
}
