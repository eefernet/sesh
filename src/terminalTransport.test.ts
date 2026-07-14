import { describe, expect, it, vi } from "vitest";
import { debounceCall, dispatchTerminalInput, inputFrame, resizeFrame } from "./terminalTransport";

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
