import { describe, expect, it } from "vitest";
import { decideDragEnd, handoffIdFromLocation } from "./detach";
import { registerTerminal, serializeTerminal } from "./terminalRegistry";

const bounds = { x: 100, y: 100, width: 800, height: 600 };

describe("tab tear-out drag decision", () => {
  it("cancels when the pointer is still inside the window", () => {
    expect(decideDragEnd({ pointerInside: true, screenX: 400, screenY: 300, windowBounds: bounds })).toBe("cancel");
    expect(decideDragEnd({ pointerInside: true, screenX: 1200, screenY: 900, windowBounds: bounds })).toBe("cancel");
  });
  it("cancels an escape-aborted drag when real coordinates land within the window", () => {
    expect(decideDragEnd({ pointerInside: false, screenX: 400, screenY: 300, windowBounds: bounds })).toBe("cancel");
  });
  it("detaches when released outside the window", () => {
    expect(decideDragEnd({ pointerInside: false, screenX: 1200, screenY: 300, windowBounds: bounds })).toBe("detach");
    expect(decideDragEnd({ pointerInside: false, screenX: 400, screenY: 900, windowBounds: bounds })).toBe("detach");
  });
  it("detaches on pointer tracking alone where the compositor hides window positions", () => {
    expect(decideDragEnd({ pointerInside: false, screenX: 400, screenY: 300 })).toBe("detach");
  });
});

describe("handoff id parsing", () => {
  it("reads the handoff id from the window search string", () => {
    expect(handoffIdFromLocation("?handoff=abc-123")).toBe("abc-123");
    expect(handoffIdFromLocation("?other=1")).toBeNull();
    expect(handoffIdFromLocation("")).toBeNull();
  });
});

describe("terminal serialize registry", () => {
  it("serializes through the registered handle and forgets it on unregister", () => {
    const unregister = registerTerminal("s1", () => "snapshot");
    expect(serializeTerminal("s1")).toBe("snapshot");
    unregister();
    expect(serializeTerminal("s1")).toBeUndefined();
  });
  it("does not let a stale unregister remove a newer handle", () => {
    const staleUnregister = registerTerminal("s2", () => "old");
    registerTerminal("s2", () => "new");
    staleUnregister();
    expect(serializeTerminal("s2")).toBe("new");
  });
});
