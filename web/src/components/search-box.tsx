"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchResult } from "@/lib/queries";
import { Skeleton } from "./skeleton";

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setResults(data.results ?? []);
        setOpen(true);
        setLoading(false);
      } catch (err) {
        // AbortError means a newer keystroke superseded this request — the
        // request that "wins" already turned loading back off, so don't touch it.
        if (!(err instanceof DOMException && err.name === "AbortError")) setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <div className="flex items-center gap-3 rounded-sm border border-white/10 bg-white/[0.04] px-4 py-3.5 transition-colors focus-within:border-white/30">
        <span className="text-white/40">⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="buscar por nome ou CPF do candidato…"
          className="w-full bg-transparent font-mono text-[13px] text-foreground placeholder:text-white/35 outline-none"
        />
        {loading ? <span className="mono-label !text-white/30">…</span> : null}
      </div>

      {open && q.trim().length >= 2 ? (
        <div className="absolute z-20 mt-2 max-h-[60vh] w-full overflow-y-auto rounded-sm border border-white/12 bg-[#0d0d10] shadow-2xl">
          {loading && results.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-white/5 px-4 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="mt-2 h-2.5 w-32" />
                </div>
                <Skeleton className="h-2.5 w-24 flex-none" />
              </div>
            ))
          ) : results.length === 0 && !loading ? (
            <div className="p-4 font-sans text-[13px] text-white/45">
              Nenhum candidato encontrado para &ldquo;{q}&rdquo;.
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.personId}
                onClick={() => {
                  setOpen(false);
                  router.push(`/politico/${r.personId}`);
                }}
                className="flex w-full items-center gap-3 border-b border-white/5 px-4 py-3 text-left transition-colors last:border-0 hover:bg-white/[0.06]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-sans text-[13.5px] text-foreground">{r.canonicalName}</div>
                  <div className="mt-1 font-mono text-[10px] text-white/40">
                    {r.latestOffice ?? "cargo n/d"} · {r.latestPartyAbbr ?? "s/partido"}/
                    {r.latestState ?? "—"} · {r.latestYear}
                    {r.candidacyCount > 1 ? ` · ${r.candidacyCount} candidaturas` : ""}
                  </div>
                </div>
                {r.cpf ? (
                  <span className="flex-none font-mono text-[10px] text-white/30">
                    CPF {r.cpf.slice(0, 3)}.***.***-**
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
