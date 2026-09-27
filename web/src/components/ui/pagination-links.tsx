import Link from "next/link";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { pageList } from "./pagination-shared";

/** Same look as <Pagination>, but for server-rendered pages that page via
 * URL (`?page=N`) instead of client state — links, not buttons. No "use
 * client" here: it's rendered straight from Server Component pages, and a
 * function prop like `makeHref` can't cross into a Client Component. */
export function PaginationLinks({
  page, totalPages, makeHref,
}: { page: number; totalPages: number; makeHref: (page: number) => string }) {
  if (totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label="paginação">
      {page > 1 ? (
        <Link href={makeHref(page - 1)} className="pagination__btn" aria-label="página anterior">
          <ChevronLeft size={14} />
        </Link>
      ) : (
        <span className="pagination__btn" aria-disabled>
          <ChevronLeft size={14} />
        </span>
      )}
      {pageList(page, totalPages).map((p, i) =>
        p === "ellipsis" ? (
          <span key={`e${i}`} className="pagination__ellipsis" aria-hidden>
            <MoreHorizontal size={14} />
          </span>
        ) : p === page ? (
          <span key={p} className="pagination__btn is-active" aria-current="page">
            {p}
          </span>
        ) : (
          <Link key={p} href={makeHref(p)} className="pagination__btn">
            {p}
          </Link>
        )
      )}
      {page < totalPages ? (
        <Link href={makeHref(page + 1)} className="pagination__btn" aria-label="próxima página">
          <ChevronRight size={14} />
        </Link>
      ) : (
        <span className="pagination__btn" aria-disabled>
          <ChevronRight size={14} />
        </span>
      )}
    </nav>
  );
}
