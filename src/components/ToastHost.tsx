import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { dismissToast, subscribeToasts, type Toast } from "../toast";

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  if (!toasts.length) return null;
  return <div className="toast-stack" role="status" aria-live="polite">
    {toasts.map((toast) => <button key={toast.id} className={`toast ${toast.kind}`} onClick={() => dismissToast(toast.id)} title="Dismiss">
      {toast.kind === "error" ? <AlertCircle size={15}/> : toast.kind === "success" ? <CheckCircle2 size={15}/> : <Info size={15}/>}
      <span>{toast.message}</span>
    </button>)}
  </div>;
}
