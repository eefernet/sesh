import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, emptyDraft, validateAppSettings, validateMachine } from "./domain";

describe("machine validation", () => {
  it("uses the configured default port for new machines", () => {
    expect(emptyDraft(2222).port).toBe(2222);
    expect(DEFAULT_APP_SETTINGS.defaultPort).toBe(22);
  });
  it("validates safe SSH application defaults", () => {
    expect(validateAppSettings(DEFAULT_APP_SETTINGS)).toBeUndefined();
    expect(validateAppSettings({ ...DEFAULT_APP_SETTINGS, terminalType: "xterm; reboot" })).toMatch(/Terminal type/);
  });
  it("accepts a complete password profile", () => { expect(validateMachine({ ...emptyDraft(), name:"Production", host:"10.0.0.4", username:"deploy" })).toEqual({}); });
  it("rejects invalid endpoint fields", () => { const errors=validateMachine({...emptyDraft(),name:"",host:"bad host",port:70000,username:"bad user"}); expect(Object.keys(errors)).toEqual(expect.arrayContaining(["name","host","port","username"])); });
  it("requires a path for key authentication", () => { expect(validateMachine({...emptyDraft(),name:"Server",host:"example.com",username:"root",authKind:"privateKey"})).toHaveProperty("privateKeyPath"); });
});
