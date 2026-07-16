export type ToastKind = "error" | "success" | "info";
export interface Toast { id: string; kind: ToastKind; message: string }

const DEFAULT_DURATION_MS = 4000;

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let counter = 0;
const listeners = new Set<Listener>();

const notify = () => { for (const listener of listeners) listener(toasts); };

export function showToast(kind: ToastKind, message: string, durationMs = DEFAULT_DURATION_MS): string {
  const id = `toast-${++counter}`;
  toasts = [...toasts, { id, kind, message }];
  notify();
  setTimeout(() => dismissToast(id), durationMs);
  return id;
}

export function dismissToast(id: string): void {
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  notify();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => { listeners.delete(listener); };
}
