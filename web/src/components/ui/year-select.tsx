"use client";

import { useRouter } from "next/navigation";

/** Year dropdown for the topbar's top-right "actions" slot (see
 * PageHeader/Topbar) — visible without scrolling regardless of which
 * section the year affects. Selecting a year does a normal navigation
 * (?ano=YYYY) against `basePath`; the page is a Server Component, so this
 * is what re-runs the year-scoped queries. Shared by every page with a
 * year filter (home, ranking, político, ficha de CPF/CNPJ). */
export function YearSelect({
  basePath, years, value, allLabel = "todos",
}: {
  basePath: string;
  years: number[];
  value?: number;
  allLabel?: string;
}) {
  const router = useRouter();
  if (years.length === 0) return null;

  return (
    <label className="flex items-center gap-2">
      <span className="mono-label">ano</span>
      <select
        value={value ?? ""}
        onChange={(e) => {
          const y = e.target.value;
          router.push(y ? `${basePath}?ano=${y}` : basePath);
        }}
        className="mono rounded-[var(--r-md)] border border-[var(--border-1)] bg-[var(--card-tone)] px-2.5 py-1.5 text-[12px] text-[var(--fg-1)] outline-none focus:border-[var(--border-2)]"
        aria-label="filtrar por ano"
      >
        <option value="">{allLabel}</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </label>
  );
}
