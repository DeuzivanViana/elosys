"use client";

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  type TooltipContentProps,
} from "recharts";
import { formatBRL } from "@/lib/format";

type Point = { year: number; totalCents: number };

function compactBRL(cents: number): string {
  const v = cents / 100;
  if (v >= 1_000_000) return `R$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$${(v / 1_000).toFixed(0)}k`;
  return `R$${v.toFixed(0)}`;
}

function ChartTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  return (
    <div className="rounded-[var(--r-sm)] border border-[var(--border-2)] bg-[var(--card-tone)] px-2.5 py-1.5">
      <div className="label" style={{ marginBottom: 2 }}>{p.year}</div>
      <div className="num" style={{ fontSize: 13 }}>{formatBRL(p.totalCents)}</div>
    </div>
  );
}

export function AssetsCurveChart({ data }: { data: Point[] }) {
  const sorted = [...data].sort((a, b) => a.year - b.year);
  if (sorted.length < 2) return null;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={sorted} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border-1)" vertical={false} />
        <XAxis
          dataKey="year"
          tick={{ fill: "var(--muted-2)", fontSize: 10, fontFamily: "var(--font-mono)" }}
          axisLine={{ stroke: "var(--border-1)" }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={compactBRL}
          tick={{ fill: "var(--muted-2)", fontSize: 9.5, fontFamily: "var(--font-mono)" }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <Tooltip content={ChartTooltip} cursor={{ fill: "var(--hover)" }} />
        <Bar dataKey="totalCents" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={56}>
          {sorted.map((p) => (
            <Cell key={p.year} fill="var(--accent)" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
