/** Which page numbers to show around the current page, collapsing the rest
 * into an ellipsis — shadcn's usual pagination shape (first, last, a window
 * around the current page, "…" for anything skipped). No directive here on
 * purpose: shared by the client <Pagination> and the server-safe
 * <PaginationLinks>, so it can't itself force a "use client" boundary. */
export function pageList(page: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set<number>([1, total, page - 1, page, page + 1]);
  const sorted = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: Array<number | "ellipsis"> = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("ellipsis");
    out.push(p);
    prev = p;
  }
  return out;
}
