import { describe, expect, it } from "vitest";
import { resolveShortcut } from "./shortcuts";

const key = (overrides: Partial<Parameters<typeof resolveShortcut>[0]>) => ({
  ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, key: "", code: "", ...overrides,
});

describe("resolveShortcut", () => {
  it("cycles workspaces with Ctrl+Tab and Ctrl+Shift+Tab", () => {
    expect(resolveShortcut(key({ ctrlKey: true, key: "Tab" }))).toEqual({ kind: "next-tab" });
    expect(resolveShortcut(key({ ctrlKey: true, shiftKey: true, key: "Tab" }))).toEqual({ kind: "prev-tab" });
  });

  it("selects a workspace by number with Ctrl+1..9", () => {
    expect(resolveShortcut(key({ ctrlKey: true, key: "1", code: "Digit1" }))).toEqual({ kind: "tab-index", index: 0 });
    expect(resolveShortcut(key({ ctrlKey: true, key: "9", code: "Digit9" }))).toEqual({ kind: "tab-index", index: 8 });
    expect(resolveShortcut(key({ ctrlKey: true, key: "0", code: "Digit0" }))).toBeUndefined();
  });

  it("closes and creates with Ctrl+Shift+W / Ctrl+Shift+N", () => {
    expect(resolveShortcut(key({ ctrlKey: true, shiftKey: true, key: "W", code: "KeyW" }))).toEqual({ kind: "close-workspace" });
    expect(resolveShortcut(key({ ctrlKey: true, shiftKey: true, key: "N", code: "KeyN" }))).toEqual({ kind: "new-connection" });
  });

  it("leaves shell and terminal keys alone", () => {
    expect(resolveShortcut(key({ ctrlKey: true, key: "w", code: "KeyW" }))).toBeUndefined();
    expect(resolveShortcut(key({ ctrlKey: true, key: "c", code: "KeyC" }))).toBeUndefined();
    expect(resolveShortcut(key({ ctrlKey: true, shiftKey: true, key: "C", code: "KeyC" }))).toBeUndefined();
    expect(resolveShortcut(key({ ctrlKey: true, shiftKey: true, key: "V", code: "KeyV" }))).toBeUndefined();
    expect(resolveShortcut(key({ ctrlKey: true, shiftKey: true, key: "F", code: "KeyF" }))).toBeUndefined();
    expect(resolveShortcut(key({ key: "Tab" }))).toBeUndefined();
    expect(resolveShortcut(key({ ctrlKey: true, altKey: true, key: "Tab" }))).toBeUndefined();
    expect(resolveShortcut(key({ ctrlKey: true, metaKey: true, key: "1", code: "Digit1" }))).toBeUndefined();
  });
});
