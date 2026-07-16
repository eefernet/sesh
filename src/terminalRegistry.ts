// Lets App serialize a pane's live xterm buffer (for tab tear-out) without
// coupling App to TerminalPane internals.
const handles = new Map<string, () => string>();

export function registerTerminal(sessionId: string, serialize: () => string): () => void {
  handles.set(sessionId, serialize);
  return () => { if (handles.get(sessionId) === serialize) handles.delete(sessionId); };
}

export function serializeTerminal(sessionId: string): string | undefined {
  return handles.get(sessionId)?.();
}
