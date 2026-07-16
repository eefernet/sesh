import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, showToast, subscribeToasts, type Toast } from "./toast";

describe("toast store", () => {
  let seen: Toast[] = [];
  let unsubscribe = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    seen = [];
    unsubscribe = subscribeToasts((toasts) => { seen = toasts; });
    for (const toast of seen) dismissToast(toast.id);
  });
  afterEach(() => {
    unsubscribe();
    vi.useRealTimers();
  });

  it("delivers shown toasts to subscribers", () => {
    showToast("error", "Could not connect");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "error", message: "Could not connect" });
  });

  it("auto-expires toasts after their duration", () => {
    showToast("info", "hello", 1000);
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(seen).toHaveLength(0);
  });

  it("dismisses on demand and ignores unknown ids", () => {
    const id = showToast("success", "saved");
    dismissToast("nope");
    expect(seen).toHaveLength(1);
    dismissToast(id);
    expect(seen).toHaveLength(0);
    dismissToast(id);
    expect(seen).toHaveLength(0);
  });

  it("stops notifying after unsubscribe", () => {
    unsubscribe();
    const before = seen;
    const id = showToast("info", "quiet");
    expect(seen).toBe(before);
    dismissToast(id);
    unsubscribe = subscribeToasts((toasts) => { seen = toasts; });
  });
});
