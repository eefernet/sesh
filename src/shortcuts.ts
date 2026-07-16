import { useEffect, useRef } from "react";

export type ShortcutAction =
  | { kind: "next-tab" }
  | { kind: "prev-tab" }
  | { kind: "tab-index"; index: number }
  | { kind: "close-workspace" }
  | { kind: "new-connection" };

type KeyInput = Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "key" | "code">;

/**
 * Global app shortcuts. Deliberately limited to combinations a remote shell
 * never needs: no plain Ctrl+letter (Ctrl+W/Ctrl+C belong to the shell) and
 * no Ctrl+Shift+C/V (terminal copy/paste conventions).
 */
export function resolveShortcut(event: KeyInput): ShortcutAction | undefined {
  if (!event.ctrlKey || event.altKey || event.metaKey) return undefined;
  if (event.key === "Tab") return event.shiftKey ? { kind: "prev-tab" } : { kind: "next-tab" };
  if (event.shiftKey) {
    if (event.code === "KeyW") return { kind: "close-workspace" };
    if (event.code === "KeyN") return { kind: "new-connection" };
    return undefined;
  }
  const digit = /^Digit([1-9])$/.exec(event.code);
  if (digit) return { kind: "tab-index", index: Number(digit[1]) - 1 };
  return undefined;
}

export function useKeyboardShortcuts(handler: (action: ShortcutAction) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    // Capture phase: fires before xterm's textarea can swallow the event.
    const listener = (event: KeyboardEvent) => {
      const action = resolveShortcut(event);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      ref.current(action);
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);
}
