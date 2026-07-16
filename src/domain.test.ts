import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, emptyDraft, parseMachineImport, serializeMachineExport, validateAppSettings, validateMachine, type MachineProfile } from "./domain";

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

describe("machine import/export", () => {
  const profile: MachineProfile = {
    id: "p1", name: "Prod", host: "10.0.0.4", port: 22, username: "deploy", authKind: "password",
    hasSavedPassword: true, hasSavedPassphrase: false, themeId: "sesh-midnight",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };

  it("exports without ids, secrets, or saved-credential flags", () => {
    const text = serializeMachineExport([profile]);
    const parsed = JSON.parse(text);
    expect(parsed.kind).toBe("sesh-machines");
    expect(parsed.profiles).toHaveLength(1);
    expect(parsed.profiles[0]).toEqual({ name: "Prod", host: "10.0.0.4", port: 22, username: "deploy", authKind: "password", themeId: "sesh-midnight" });
    expect(text).not.toContain("hasSavedPassword");
    expect(text).not.toContain('"id"');
  });

  it("round-trips an export into clean drafts", () => {
    const result = parseMachineImport(serializeMachineExport([profile]));
    if ("error" in result) throw new Error(result.error);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({ name: "Prod", host: "10.0.0.4", savePassword: false, savePassphrase: false });
    expect(result.drafts[0].id).toBeUndefined();
  });

  it("rejects malformed files with a readable error", () => {
    expect(parseMachineImport("not json")).toHaveProperty("error");
    expect(parseMachineImport('{"kind":"other"}')).toHaveProperty("error");
    expect(parseMachineImport('{"schemaVersion":1,"kind":"sesh-machines","profiles":[]}')).toHaveProperty("error");
    expect(parseMachineImport('{"schemaVersion":1,"kind":"sesh-machines","profiles":[{"name":"","host":"h","port":22,"username":"u","authKind":"password"}]}')).toHaveProperty("error");
  });
});
