import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { SessionSummary } from "./domain";

export interface WorkspaceHandoff {
  workspace: { id: string; name: string; sessions: SessionSummary[] };
  serialized: Record<string, string>;
}

export const HANDOFF_REQUEST = "sesh:handoff-request";
export const handoffPayloadEvent = (handoffId: string) => `sesh:handoff-payload-${handoffId}`;
export const handoffIdFromLocation = (search: string): string | null => new URLSearchParams(search).get("handoff");

const DEV_HANDOFF_PREFIX = "sesh.dev.handoff.";
export const takeBrowserHandoff = (handoffId: string): WorkspaceHandoff | undefined => {
  const raw = localStorage.getItem(DEV_HANDOFF_PREFIX + handoffId);
  if (!raw) return undefined;
  localStorage.removeItem(DEV_HANDOFF_PREFIX + handoffId);
  try { return JSON.parse(raw) as WorkspaceHandoff; } catch { return undefined; }
};

export type DragEndDecision = "detach" | "cancel";
export interface DragEndInput {
  pointerInside: boolean;
  screenX: number;
  screenY: number;
  windowBounds?: { x: number; y: number; width: number; height: number };
}

// The primary signal is whether the pointer was still inside the window when
// the drag ended, tracked from dragenter/dragover/drop (inside) and a
// dragleave that exits the window (outside). Drop coordinates and dropEffect
// are unusable for this on Wayland: window.screenX/screenY is frame-offset
// garbage, drag coordinates are window-relative, and the compositor may
// accept the drop itself. Only pass windowBounds when the backend's
// window_positioning_reliable command says positions are real; there it turns
// an Esc-cancelled drag released over the window into a "cancel" instead of a
// detach.
// The drag payload deliberately uses a private MIME type
// (application/x-sesh-workspace) so external targets like the Plasma desktop
// do not accept the drop (text/plain becomes a desktop note widget).
export function decideDragEnd({ pointerInside, screenX, screenY, windowBounds: b }: DragEndInput): DragEndDecision {
  if (pointerInside) return "cancel";
  if (b && screenX >= b.x && screenX <= b.x + b.width && screenY >= b.y && screenY <= b.y + b.height) return "cancel";
  return "detach";
}

export async function openWorkspaceWindow(handoffId: string, name: string, position?: { x: number; y: number }, browserPayload?: WorkspaceHandoff): Promise<void> {
  if (browserPayload) {
    localStorage.setItem(DEV_HANDOFF_PREFIX + handoffId, JSON.stringify(browserPayload));
    window.open(`/?handoff=${handoffId}`, "_blank", "width=1000,height=700");
    return;
  }
  console.log("[detach] creating window", `workspace-${handoffId}`, position);
  const child = new WebviewWindow(`workspace-${handoffId}`, {
    url: `/?handoff=${handoffId}`,
    title: `sesh — ${name}`,
    width: 1000,
    height: 700,
    minWidth: 760,
    minHeight: 540,
    transparent: true,
    ...(position ? { x: position.x, y: position.y } : {}),
  });
  void child.once("tauri://created", () => console.log("[detach] window created"));
  void child.once("tauri://error", (event) => console.error("[detach] workspace window failed to open", event.payload));
}
