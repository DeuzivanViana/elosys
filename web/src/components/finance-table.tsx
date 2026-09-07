"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { FinancePage, FinanceRow, FinanceSort } from "@/lib/queries";
import { formatBRL, formatCpfCnpj } from "@/lib/format";
import { Skeleton } from "./skeleton";

type Props = {
  title: string;
  scope: "candidate" | "entity";
  id: string;
  dir: "received" | "spent" | "given";
  /** Text for the "counterparty" column header, e.g. "doador" / "fornecedor". */
  counterpartyLabel: string;
  /** amber for money out, green for money in — matches the rest of the app. */
  tone: "green" | "amber" | "neutral";
};

const AMOUNT_TONE: Record<Props["tone"], string> = {
  green: "text-elo-green",
  amber: "text-elo-amber",
  neutral: "text-white/80",
};

// which direction a column sorts "first" when you click it fresh
const DEFAULT_DIR: Record<FinanceSort, "asc" | "desc"> = {
  name: "asc",
  amount: "desc",
  paid: "desc",
  year: "desc",
  date: "desc",
};

function hrefFor(r: FinanceRow): string | null {
  if (r.counterpartyPersonId != null) return `/politico/${r.counterpartyPersonId}`;
  const d = r.counterpartyDoc;
  if (!d) return null;
  return d.length === 14 ? `/cnpj/${d}` : d.length === 11 ? `/cpf/${d}` : null;
}

export function FinanceTable({ title, scope, id, dir, counterpartyLabel, tone }: Props) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<FinanceSort>("amount");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [data, setData] = useState<FinancePage | null>(null);
  const [loading, setLoading] = useState(true);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const t = setTimeout(() => {
      setLoading(true);
      const usp = new URLSearchParams({ scope, id, dir, page: String(page), sort, order });
      if (q.trim()) usp.set("q", q.trim());
      fetch(`/api/finance?${usp}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d: FinancePage) => setData(d))
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, q ? 250 : 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [scope, id, dir, page, q, sort, order]);

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showExpense = dir === "spent" || (scope === "entity" && dir === "received");
  const rows = data?.rows ?? [];

  const toggleSort = (col: FinanceSort) => {
    setPage(1);
    if (col === sort) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(col);
      setOrder(DEFAULT_DIR[col]);
    }
  };

  const th = (col: FinanceSort, label: string, align: "left" | "right" = "left") => (
    <th className={`py-2 ${align === "right" ? "text-right" : "text-left"} font-normal`}>
      <button
        onClick={() => toggleSort(col)}
        className={`inline-flex items-center gap-1 hover:text-white/70 ${sort === col ? "text-foreground" : ""}`}
      >
        {label}
        <span className="text-[8px] text-white/40">{sort === col ? (order === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  const colCount = 4 + (showExpense ? 1 : 0);

  return (
    <section className="border-b border-white/[0.07] py-10 last:border-0">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="mono-label">{title}</div>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder={`buscar ${counterpartyLabel}…`}
          className="w-56 rounded-sm border border-white/12 bg-white/[0.04] px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-white/30 outline-none focus:border-white/30"
        />
      </div>

      {total === 0 && !loading ? (
        <p className="text-[13px] text-white/40">
          {q ? "Nada encontrado para essa busca." : "Nenhum registro."}
        </p>
      ) : (
        <>
          <div className="mb-3 font-mono text-[10.5px] text-white/35">
            {total.toLocaleString("pt-BR")} {total === 1 ? "registro" : "registros"}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-white/[0.12] font-mono text-[9px] tracking-[0.1em] text-white/35 uppercase">
                  {th("name", counterpartyLabel)}
                  <th className="py-2 text-left font-normal">detalhe</th>
                  {th("date", "data")}
                  {th("year", "ano")}
                  {th("amount", "valor", "right")}
                  {showExpense ? th("paid", "pago", "right") : null}
                </tr>
              </thead>
              <tbody className={loading ? "opacity-40" : ""}>
                {loading && rows.length === 0
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-white/[0.06]">
                        <td className="py-3 pr-3"><Skeleton className="h-3 w-40" /></td>
                        <td className="py-3 pr-3"><Skeleton className="h-3 w-32" /></td>
                        <td className="py-3 pr-3"><Skeleton className="h-3 w-16" /></td>
                        <td className="py-3 pr-3"><Skeleton className="h-3 w-8" /></td>
                        <td className="py-3 pl-3"><Skeleton className="ml-auto h-3 w-20" /></td>
                        {showExpense ? <td className="py-3 pl-3"><Skeleton className="ml-auto h-3 w-20" /></td> : null}
                      </tr>
                    ))
                  : rows.map((r) => {
                      const href = hrefFor(r);
                      const name = r.counterpartyName ?? "não identificado";
                      return (
                        <tr key={r.id} className="border-b border-white/[0.06] align-top">
                          <td className="max-w-[220px] py-2.5 pr-3">
                            {href ? (
                              <Link href={href} className="hover:text-elo-amber hover:underline">
                                {name}
                              </Link>
                            ) : (
                              name
                            )}
                            {r.counterpartyDoc ? (
                              <div className="font-mono text-[9.5px] text-white/30">
                                {formatCpfCnpj(r.counterpartyDoc)}
                                {r.counterpartyOpenedAt ? ` · aberta ${r.counterpartyOpenedAt}` : ""}
                              </div>
                            ) : null}
                          </td>
                          <td className="max-w-[240px] py-2.5 pr-3 text-white/55">{r.detail ?? "—"}</td>
                          <td className="py-2.5 pr-3 font-mono text-white/45">{r.date ?? "—"}</td>
                          <td className="py-2.5 pr-3 font-mono text-white/45">{r.year}</td>
                          <td className={`py-2.5 pl-3 text-right font-mono ${AMOUNT_TONE[tone]}`}>
                            {formatBRL(r.amountCents)}
                          </td>
                          {showExpense ? (
                            <td className="py-2.5 pl-3 text-right font-mono text-white/45">
                              {r.paidCents != null ? formatBRL(r.paidCents) : "—"}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                {!loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="py-6 text-center font-mono text-[11px] text-white/30">
                      nada nesta página
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="mt-4 flex items-center gap-4 font-mono text-[11px] text-white/45">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="disabled:text-white/15 hover:text-white/70"
              >
                ← anterior
              </button>
              <span>
                página {page} de {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="disabled:text-white/15 hover:text-white/70"
              >
                próxima →
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
