"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { FinancePage, FinanceRow, FinanceSort } from "@/lib/queries";
import { formatBRL, formatCpfCnpj } from "@/lib/format";
import { Skeleton } from "./skeleton";
import { Pagination } from "./ui/pagination";
import { Modal } from "./ui/modal";
import { DateRangePicker } from "./ui/date-range-picker";
import { EmptyState } from "./ui/empty-state";
import { SearchAvatar } from "./search-avatar";
import { SourceZone } from "./source-zone";

type Props = {
  title: string;
  scope: "candidate" | "entity";
  id: string;
  dir: "received" | "spent" | "given";
  counterpartyLabel: string;
  tone: "green" | "amber" | "neutral";
  year?: number;
};

const AMOUNT_TONE: Record<Props["tone"], string> = {
  green: "text-elo-green",
  amber: "text-elo-amber",
  neutral: "text-[var(--fg-2)]",
};

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

function reaisToCents(v: string): number | undefined {
  const trimmed = v.trim().replace(",", ".");
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

export function FinanceTable({ title, scope, id, dir, counterpartyLabel, tone, year }: Props) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<FinanceSort>("amount");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [onlyPoliticianOwned, setOnlyPoliticianOwned] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<FinancePage | null>(null);
  const [loading, setLoading] = useState(true);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => setPage(1), [year]);

  useEffect(() => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const t = setTimeout(() => {
      setLoading(true);
      const usp = new URLSearchParams({ scope, id, dir, page: String(page), sort, order });
      if (q.trim()) usp.set("q", q.trim());
      if (year != null) usp.set("year", String(year));
      if (dateFrom) usp.set("dateFrom", dateFrom);
      if (dateTo) usp.set("dateTo", dateTo);
      const minCents = reaisToCents(amountMin);
      const maxCents = reaisToCents(amountMax);
      if (minCents != null) usp.set("amountMin", String(minCents));
      if (maxCents != null) usp.set("amountMax", String(maxCents));
      if (onlyPoliticianOwned) usp.set("onlyPoliticianOwned", "1");
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
  }, [scope, id, dir, page, q, year, sort, order, dateFrom, dateTo, amountMin, amountMax, onlyPoliticianOwned]);

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showExpense = dir === "spent" || (scope === "entity" && dir === "received");
  const rows = data?.rows ?? [];

  const activeFilterCount =
    (q.trim() ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0) +
    (amountMin || amountMax ? 1 : 0) +
    (onlyPoliticianOwned ? 1 : 0);

  const clearFilters = () => {
    setPage(1);
    setQ("");
    setDateFrom("");
    setDateTo("");
    setAmountMin("");
    setAmountMax("");
    setOnlyPoliticianOwned(false);
  };

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
    <th aria-sort={sort === col ? "other" : undefined} className={align === "right" ? "text-right" : ""}>
      <button
        onClick={() => toggleSort(col)}
        className="inline-flex items-center gap-1"
        style={{ color: sort === col ? "var(--accent-2)" : undefined }}
      >
        {label}
        <span className="mono" style={{ fontSize: 8, color: "var(--muted-2)" }}>
          {sort === col ? (order === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );

  const colCount = 3 + (showExpense ? 1 : 0);
  const amountLabel = `valor${showExpense ? " / pago" : ""}`;

  return (
    <section className="py-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="label">{title}</div>
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className="btn"
          style={{ position: "relative" }}
        >
          ⚙ filtros
          {activeFilterCount > 0 ? (
            <span className="badge badge--flag" style={{ padding: "0 5px", fontSize: 10 }}>
              {activeFilterCount}
            </span>
          ) : null}
        </button>
      </div>

      {filtersOpen ? (
        <Modal title={`filtros — ${counterpartyLabel}`} onClose={() => setFiltersOpen(false)}>
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-1.5">
              <span className="mono-label">buscar {counterpartyLabel}</span>
              <div className="input">
                <input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                  placeholder={`nome do ${counterpartyLabel}…`}
                  autoFocus
                />
              </div>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="mono-label">período</span>
              <DateRangePicker
                from={dateFrom || undefined}
                to={dateTo || undefined}
                onChange={({ from, to }) => {
                  setPage(1);
                  setDateFrom(from ?? "");
                  setDateTo(to ?? "");
                }}
              />
            </label>

            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="mono-label">{amountLabel} — mín. R$</span>
                <div className="input">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={amountMin}
                    onChange={(e) => {
                      setAmountMin(e.target.value);
                      setPage(1);
                    }}
                    placeholder="0"
                  />
                </div>
              </label>
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="mono-label">{amountLabel} — máx. R$</span>
                <div className="input">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={amountMax}
                    onChange={(e) => {
                      setAmountMax(e.target.value);
                      setPage(1);
                    }}
                    placeholder="sem limite"
                  />
                </div>
              </label>
            </div>
            {showExpense ? (
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted-2)" }}>
                O range acima considera <strong>valor OU pago</strong> — uma despesa entra se
                qualquer um dos dois cair na faixa.
              </p>
            ) : null}

            {scope === "candidate" ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyPoliticianOwned}
                  onChange={(e) => {
                    setPage(1);
                    setOnlyPoliticianOwned(e.target.checked);
                  }}
                />
                <span className="text-[13px]" style={{ color: "var(--fg-1)" }}>
                  mostrar só <span className="badge badge--flag" style={{ padding: "1px 6px" }}>⚑ empresa de político</span>
                </span>
              </label>
            ) : null}

            <div className="flex justify-between border-t border-[var(--border-1)] pt-4">
              <button
                type="button"
                className="mono-label hover:text-[var(--accent-2)]"
                onClick={clearFilters}
                disabled={activeFilterCount === 0}
                style={{ opacity: activeFilterCount === 0 ? 0.4 : 1 }}
              >
                limpar filtros
              </button>
              <button type="button" className="btn btn--primary" onClick={() => setFiltersOpen(false)}>
                aplicar
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {total === 0 && !loading ? (
        <EmptyState
          icon="◌"
          title={activeFilterCount > 0 ? "Nada encontrado para esses filtros." : "Nenhum registro."}
          hint={activeFilterCount > 0 ? "tente ajustar ou limpar os filtros" : undefined}
        />
      ) : (
        <>
          <div className="mono mb-3" style={{ fontSize: 10.5, color: "var(--muted-2)" }}>
            {total.toLocaleString("pt-BR")} {total === 1 ? "registro" : "registros"}
          </div>
          <div className="table-wrap">
            <div className="overflow-x-auto">
              <table className="table min-w-[680px]">
                <thead>
                  <tr>
                    {th("name", counterpartyLabel)}
                    <th>detalhe</th>
                    {th("date", "data")}
                    {th("amount", "valor", "right")}
                    {showExpense ? th("paid", "pago", "right") : null}
                  </tr>
                </thead>
                <tbody className={loading ? "opacity-40" : ""}>
                  {loading && rows.length === 0
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i}>
                          <td><Skeleton className="h-3 w-40" /></td>
                          <td><Skeleton className="h-3 w-32" /></td>
                          <td><Skeleton className="h-3 w-16" /></td>
                          <td><Skeleton className="ml-auto h-3 w-20" /></td>
                          {showExpense ? <td><Skeleton className="ml-auto h-3 w-20" /></td> : null}
                        </tr>
                      ))
                    : rows.map((r) => {
                        const href = hrefFor(r);
                        const name = r.counterpartyName ?? "não identificado";
                        return (
                          <SourceZone key={r.id} as="tr" provenance={r.provenance}>
                            <td className="max-w-[220px]">
                              {r.counterpartyIsPoliticianOwned ? (
                                <div className="mb-2">
                                  <span
                                    className="badge badge--flag"
                                    title="Um sócio desta empresa também é candidato (ver /sinais/socio-fornecedor)"
                                  >
                                    ⚑ empresa de político
                                  </span>
                                </div>
                              ) : null}
                              <div className="flex items-center gap-2">
                                {r.counterpartyPersonId != null ? (
                                  <SearchAvatar photoUrl={r.counterpartyPhotoUrl} name={name} />
                                ) : null}
                                {href ? (
                                  <Link href={href} className="link-primary">
                                    {name}
                                  </Link>
                                ) : (
                                  name
                                )}
                              </div>
                              {r.counterpartyDoc ? (
                                <div className="mono" style={{ fontSize: 9.5, color: "var(--muted-2)" }}>
                                  {formatCpfCnpj(r.counterpartyDoc)}
                                  {r.counterpartyOpenedAt ? ` (${r.counterpartyOpenedAt.slice(0, 4)})` : ""}
                                </div>
                              ) : null}
                            </td>
                            <td className="max-w-[240px]" style={{ fontSize: 12, color: "var(--muted)" }}>{r.detail ?? "—"}</td>
                            <td className="num" style={{ textAlign: "left", color: "var(--muted)" }}>{r.date ?? "—"}</td>
                            <td className={`num ${AMOUNT_TONE[tone]}`}>{formatBRL(r.amountCents)}</td>
                            {showExpense ? (
                              <td className="num" style={{ color: "var(--muted)" }}>
                                {r.paidCents != null ? formatBRL(r.paidCents) : "—"}
                              </td>
                            ) : null}
                          </SourceZone>
                        );
                      })}
                  {!loading && rows.length === 0 ? (
                    <tr>
                      <td colSpan={colCount} className="mono text-center" style={{ fontSize: 11, color: "var(--muted-2)" }}>
                        nada nesta página
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {totalPages > 1 ? (
              <div className="table-footer">
                <Pagination page={page} totalPages={totalPages} onChange={setPage} />
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
