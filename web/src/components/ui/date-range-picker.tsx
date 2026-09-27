"use client";

import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmt(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** A "de/até" date range, picked from a shadcn/react-day-picker calendar in
 * a popover — not two bare <input type=date>, so the two ends of the range
 * are visibly one gesture (drag/click-click) instead of two disconnected
 * fields. */
export function DateRangePicker({
  from, to, onChange,
}: {
  from?: string; // 'YYYY-MM-DD'
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
}) {
  const [open, setOpen] = useState(false);

  const selected: DateRange | undefined = from || to
    ? { from: from ? fromISO(from) : undefined, to: to ? fromISO(to) : undefined }
    : undefined;

  const label = selected?.from
    ? selected.to && selected.to.getTime() !== selected.from.getTime()
      ? `${fmt(selected.from)} – ${fmt(selected.to)}`
      : fmt(selected.from)
    : "qualquer data";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="mono flex items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--border-1)] bg-[var(--card-tone)] px-2.5 py-1.5 text-[12px] text-[var(--fg-1)] outline-none hover:border-[var(--border-2)]"
      >
        <CalendarIcon className="size-3.5" style={{ color: "var(--muted-2)" }} />
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="range"
          selected={selected}
          defaultMonth={selected?.from}
          onSelect={(r) => {
            onChange({ from: r?.from ? toISO(r.from) : undefined, to: r?.to ? toISO(r.to) : undefined });
          }}
          numberOfMonths={1}
        />
        {selected?.from ? (
          <button
            type="button"
            className="mono-label w-full py-1.5 text-center hover:text-[var(--accent-2)]"
            onClick={() => {
              onChange({ from: undefined, to: undefined });
              setOpen(false);
            }}
          >
            limpar data
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
