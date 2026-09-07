import type { Provenance } from "@/lib/queries";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "UTC",
    }) + " UTC";
  } catch {
    return iso;
  }
}

/**
 * Every field on this page comes from a specific downloaded file — this is
 * the non-repúdio trail: which source, which URL, when we fetched it, and
 * the sha256 that `elosys verify` re-checks against the live file.
 */
export function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  return (
    <details className="group mt-2 w-fit">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] tracking-[0.1em] text-white/40 uppercase transition-colors hover:border-white/25 hover:text-white/70">
        <span className="inline-block size-1 rounded-full bg-elo-green" />
        fonte: {provenance.sourceName}
        <span className="text-white/25 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="mt-2 max-w-md space-y-1.5 rounded-sm border border-white/10 bg-white/[0.03] p-3 font-mono text-[10.5px] leading-relaxed text-white/55">
        <Row label="órgão" value={provenance.agency} />
        <Row
          label="url"
          value={
            <a
              href={provenance.url}
              target="_blank"
              rel="noreferrer"
              className="text-elo-amber break-all hover:text-elo-amber-bright hover:underline"
            >
              {provenance.url}
            </a>
          }
        />
        <Row label="coletado em" value={formatDate(provenance.accessedAt)} />
        <Row label="sha256" value={<span className="break-all">{provenance.sha256}</span>} />
        <Row label="parser" value={`${provenance.parserName} v${provenance.parserVersion}`} />
        {provenance.legalBasis ? <Row label="base legal" value={provenance.legalBasis} /> : null}
      </div>
    </details>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 flex-none text-white/30">{label}</span>
      <span className="min-w-0 flex-1">{value}</span>
    </div>
  );
}
