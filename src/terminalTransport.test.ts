import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeTerminalTransport, debounceCall, dispatchTerminalInput, inputFrame, resizeFrame, type TransportState } from "./terminalTransport";

describe("terminal transport", () => {
  it("dispatches keyboard input immediately", () => {
    const send = vi.fn();
    dispatchTerminalInput(send, "session-1", "x");
    expect(send).toHaveBeenCalledWith("session-1", "x");
  });

  it("encodes input as a compact session-scoped binary frame", () => {
    const frame = inputFrame("00112233-4455-6677-8899-aabbccddeeff", "é");
    expect(frame[0]).toBe(1);
    expect([...frame.slice(1, 17)]).toEqual([0,17,34,51,68,85,102,119,136,153,170,187,204,221,238,255]);
    expect([...frame.slice(17)]).toEqual([195,169]);
  });

  it("encodes resize dimensions in network byte order", () => {
    const frame = resizeFrame("00112233-4455-6677-8899-aabbccddeeff", 120, 36);
    const view = new DataView(frame.buffer);
    expect(frame[0]).toBe(2);
    expect(view.getUint32(17)).toBe(120);
    expect(view.getUint32(21)).toBe(36);
  });

  it("coalesces resize events without delaying input", () => {
    vi.useFakeTimers();
    const resize = vi.fn();
    const debounced = debounceCall(resize, 50);
    debounced.schedule(80, 24);
    debounced.schedule(100, 32);
    expect(resize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(resize).toHaveBeenCalledOnce();
    expect(resize).toHaveBeenCalledWith(100, 32);
    vi.useRealTimers();
  });
});

const SESSION = "00112233-4455-6677-8899-aabbccddeeff";
const INFO = { port: 1234, token: "secret-token", protocolVersion: 1 };

class FakeSocket {
  static instances: FakeSocket[] = [];
  binaryType = "";
  sent: unknown[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(data: unknown) { this.sent.push(data); }
  open() { this.readyState = WebSocket.OPEN; this.onopen?.(); }
  fail() { this.onerror?.(); this.onclose?.(); }
}

const makeTransport = () => new NativeTerminalTransport({
  createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
  fetchInfo: async () => ({ ...INFO }),
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("native terminal transport", () => {
  beforeEach(() => { FakeSocket.instances = []; });

  it("queues frames sent before the socket opens and flushes them in order", async () => {
    const transport = makeTransport();
    transport.sendInput(SESSION, "a");
    transport.sendInput(SESSION, "b");
    await flush();
    const socket = FakeSocket.instances[0];
    expect(socket.sent).toHaveLength(0);
    socket.open();
    expect(socket.sent[0]).toBe(INFO.token);
    const payloads = socket.sent.slice(1).map((frame) => (frame as Uint8Array)[17]);
    expect(payloads).toEqual(["a".charCodeAt(0), "b".charCodeAt(0)]);
  });

  it("bounds the pending queue by dropping the oldest frame", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = makeTransport();
    for (let index = 0; index < 300; index++) transport.sendInput(SESSION, "x");
    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();
    expect(socket.sent).toHaveLength(1 + 256);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reports down after exhausting retries and revives on the next send", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const states: TransportState[] = [];
    const transport = makeTransport();
    transport.onState((state) => states.push(state));
    const unsubscribe = transport.subscribe(SESSION, () => {});
    await vi.advanceTimersByTimeAsync(0);
    for (let round = 0; round < 8; round++) {
      FakeSocket.instances.at(-1)?.fail();
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(states).toContain("reconnecting");
    expect(states.at(-1)).toBe("down");

    const attempts = FakeSocket.instances.length;
    transport.sendInput(SESSION, "x");
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.instances.length).toBeGreaterThan(attempts);
    FakeSocket.instances.at(-1)!.open();
    expect(states.at(-1)).toBe("connected");
    const revived = FakeSocket.instances.at(-1)!;
    expect(revived.sent.slice(1)).toHaveLength(1);
    unsubscribe();
    error.mockRestore();
    vi.useRealTimers();
  });
});
