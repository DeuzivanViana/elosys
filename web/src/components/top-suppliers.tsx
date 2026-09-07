"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TopSupplier } from "@/lib/queries";
import { formatBRL, formatCnpj } from "@/lib/format";
import { Skeleton } from "./skeleton";

export function TopSuppliers({ years }: { years: number[] }) {
  // Default to the most recent election, not "todas" — the all-time ranking
  // aggregates ~9M+ rows and takes several seconds; per-year is near-instant.
  const [year, setYear] = useState<string>(years[0] ? String(years[0]) : "all");
  const [suppliers, setSuppliers] = useState<TopSupplier[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/top-suppliers?year=${year}`)
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) setSuppliers(data.suppliers ?? []);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [year]);

  const max = suppliers.length > 0 ? suppliers[0].totalCents : 1;

  return (
    <section className="border-b border-white/[0.07] px-6 py-14 sm:px-14">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mono-label">prestação de contas eleitorais · despesas pagas a fornecedores</div>
          <h2 className="mt-3 text-[28px] leading-tight font-light tracking-tight sm:text-[34px]">
            Empresas que mais faturaram com campanhas
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="year-select" className="mono-label !text-white/45">
            eleição
          </label>
          <select
            id="year-select"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="rounded-sm border border-white/12 bg-white/[0.04] px-3 py-2 font-mono text-[11px] text-foreground outline-none focus:border-white/30"
          >
            <option value="all">todas</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="border-b border-white/[0.06] py-3.5 last:border-0">
              <div className="flex items-baseline gap-3">
                <span className="w-6 flex-none font-mono text-[11px] text-white/15">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-3.5 w-24 flex-none" />
              </div>
              <div className="mt-2 pl-9">
                <Skeleton className="h-[3px] w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : suppliers.length === 0 ? (
        <div className="py-10 text-center font-mono text-[11px] text-white/35">
          sem despesas contratadas para esse filtro.
        </div>
      ) : (
        <div className="flex flex-col">
          {suppliers.map((s, i) => (
            <div key={s.cnpj} className="border-b border-white/[0.06] py-3.5 last:border-0">
              <div className="flex items-baseline gap-3">
                <span className="w-6 flex-none font-mono text-[11px] text-white/30">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <Link
                  href={`/cnpj/${s.cnpj}`}
                  className="min-w-0 flex-1 truncate text-[14px] hover:text-elo-amber hover:underline"
                >
                  {s.name}
                </Link>
                <span className="flex-none font-mono text-[13px] text-elo-amber">
                  {formatBRL(s.totalCents)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3 pl-9">
                <div className="h-[3px] flex-1 bg-white/[0.07]">
                  <div
                    className="h-[3px] bg-elo-amber"
                    style={{ width: `${Math.max(2, (s.totalCents / max) * 100)}%` }}
                  />
                </div>
                <span className="flex-none font-mono text-[9.5px] text-white/35">
                  {formatCnpj(s.cnpj)} · {s.paymentCount.toLocaleString("pt-BR")} pagamentos ·{" "}
                  {s.candidacyCount.toLocaleString("pt-BR")} candidaturas
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
