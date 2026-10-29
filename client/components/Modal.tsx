import { useContext, useEffect, useRef, type ReactNode } from "react";
import { TriangleAlert, X } from "lucide-react";
import { createContext } from "react";
export const DialogErrorContext = createContext("");
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const error = useContext(DialogErrorContext);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={wide ? "modal wide" : "modal"}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <p className="eyebrow">BIDCAIRN WORKSPACE</p>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <TriangleAlert size={16} />
          {error}
        </div>
      )}
      {children}
    </dialog>
  );
}
