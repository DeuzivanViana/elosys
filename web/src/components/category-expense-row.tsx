"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { ExpenseCategoryDetailRow, ExpenseCategoryRow } from "@/lib/queries";
import { formatBRL, formatPct } from "@/lib/format";
import { SearchAvatar } from "./search-avatar";
import { SourceZone } from "./source-zone";
import { Skeleton } from "./skeleton";

export function CategoryExpenseRow({
  r, category, year,
}: {
  r: ExpenseCategoryRow;
  category: string | undefined;
  year: number | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ExpenseCategoryDetailRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || rows != null) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      const usp = new URLSearchParams({ personId: String(r.personId) });
      if (category) usp.set("categoria", category);
      if (year != null) usp.set("ano", String(year));
      fetch(`/api/despesa-desproporcional-detalhe?${usp}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((data: { rows: ExpenseCategoryDetailRow[] }) => setRows(data.rows))
        .catch((e) => { if (e.name !== "AbortError") setRows([]); })
        .finally(() => setLoading(false));
    }, 0);
    return () => { clearTimeout(t); controller.abort(); };
  }, [open, rows, r.personId, category, year]);

  const timesPeer =
    r.sharePct != null && r.peerAvgSharePct != null && r.peerAvgSharePct > 0
      ? r.sharePct / r.peerAvgSharePct
      : null;

  return (
    <>
      <tr className="align-top cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td>
          <div className="flex items-center gap-2.5">
            <span className="shrink-0" style={{ color: "var(--muted-2)" }} aria-hidden>
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
            <SearchAvatar photoUrl={r.photoUrl} name={r.name ?? "?"} />
            <Link
              href={`/politico/${r.personId}`}
              className="hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {r.name ?? "candidato"}
            </Link>
          </div>
        </td>
        <td style={{ color: "var(--muted)" }}>
          {r.office ?? "—"}
          {r.state ? <span style={{ color: "var(--muted-2)" }}> · {r.state}</span> : null}
        </td>
        <td className="num" style={{ color: "var(--accent-2)" }}>
          {formatBRL(r.categoryCents)}
          <div style={{ fontSize: 9.5, color: "var(--muted-2)" }}>
            {r.categoryCount.toLocaleString("pt-BR")} despesa(s)
          </div>
        </td>
        <td className="num">
          {r.sharePct != null ? formatPct(r.sharePct) : "—"}
          {r.revenueCents === 0 ? (
            <div style={{ fontSize: 9.5, color: "var(--muted-2)" }}>sem receita declarada</div>
          ) : null}
        </td>
        <td className="num">
          {r.peerAvgSharePct != null ? (
            <>
              {formatPct(r.peerAvgSharePct)}
              <div style={{ fontSize: 9.5, color: "var(--muted-2)" }}>
                {r.peerCount} par(es)
                {timesPeer != null && timesPeer >= 2 ? (
                  <span style={{ color: "var(--red)" }}> · {timesPeer.toFixed(1)}x a média</span>
                ) : null}
              </div>
            </>
          ) : (
            "—"
          )}
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={5} style={{ paddingTop: 0, paddingBottom: 10 }}>
            <div>
              {loading ? (
                <div className="flex flex-col gap-2 py-1">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-4/5" />
                  <Skeleton className="h-3.5 w-3/5" />
                </div>
              ) : !rows || rows.length === 0 ? (
                <div className="py-1 text-[11px]" style={{ color: "var(--muted)" }}>
                  nenhuma despesa encontrada.
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-1)]">
                  {rows.map((row) => (
                    <SourceZone
                      key={row.id}
                      as="div"
                      provenance={row.provenance}
                      className="flex items-center justify-between gap-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-left text-[11.5px]" style={{ color: "var(--fg-2)" }}>
                          {row.description}
                        </div>
                        <div className="mono-label" style={{ fontSize: 8.5 }}>{row.year}</div>
                      </div>
                      <div className="num shrink-0" style={{ fontSize: 12, color: "var(--accent-2)" }}>
                        {formatBRL(row.amountCents)}
                      </div>
                    </SourceZone>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
