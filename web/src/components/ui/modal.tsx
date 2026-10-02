"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export function Modal({
  title, onClose, children,
}: { title?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {title ? (
          <div className="modal__header">
            <span className="mono-label">{title}</span>
            <button type="button" className="modal__close" onClick={onClose} aria-label="fechar">
              ×
            </button>
          </div>
        ) : null}
        <div className="modal__body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
