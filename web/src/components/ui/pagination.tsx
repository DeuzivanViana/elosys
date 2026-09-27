"use client";

import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { pageList } from "./pagination-shared";

export function Pagination({
  page, totalPages, onChange,
}: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label="paginação">
      <button
        type="button"
        className="pagination__btn"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        aria-label="página anterior"
      >
        <ChevronLeft size={14} />
      </button>
      {pageList(page, totalPages).map((p, i) =>
        p === "ellipsis" ? (
          <span key={`e${i}`} className="pagination__ellipsis" aria-hidden>
            <MoreHorizontal size={14} />
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={`pagination__btn${p === page ? " is-active" : ""}`}
            onClick={() => onChange(p)}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </button>
        )
      )}
      <button
        type="button"
        className="pagination__btn"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        aria-label="próxima página"
      >
        <ChevronRight size={14} />
      </button>
    </nav>
  );
}
