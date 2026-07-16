import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const layer = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const node = section.current;
    const previous = document.activeElement as HTMLElement | null;
    if (node && !node.contains(document.activeElement)) {
      const auto = node.querySelector<HTMLElement>("[autofocus]");
      (auto ?? node).focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Only the topmost modal reacts, so a confirm stacked over an editor
        // does not close both.
        const layers = document.querySelectorAll(".modal-layer");
        if (layers[layers.length - 1] === layer.current) { event.stopPropagation(); closeRef.current(); }
        return;
      }
      if (event.key !== "Tab" || !node || !node.contains(document.activeElement)) return;
      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("keydown", onKeyDown, true); previous?.focus?.(); };
  }, []);
  return <div ref={layer} className="modal-layer" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section ref={section} className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header><div><span className="eyebrow">sesh</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></header>
      {children}
    </section>
  </div>;
}
