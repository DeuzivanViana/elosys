import Link from "next/link";
import { getCircularDonationSignals, getCircularDonationSummary, type CircularDonationSort } from "@/lib/queries";
import { entityHref, formatBRL, formatCpfCnpj } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const SEVERITIES = ["high", "medium", "low"] as const;
const SEVERITY_LABEL: Record<string, string> = { high: "alta", medium: "média", low: "baixa" };
const SEVERITY_COLOR: Record<string, string> = {
  high: "text-elo-red border-elo-red/40",
  medium: "text-elo-amber border-elo-amber/40",
  low: "text-white/50 border-white/20",
};
const SORTS: Array<{ value: CircularDonationSort; label: string }> = [
  { value: "severity", label: "severidade" },
  { value: "amount", label: "valor movimentado" },
  { value: "path_length", label: "tamanho do caminho" },
];

export default async function CircularDonationsPage({
  searchParams,
}: PageProps<"/sinais/doacao-circular">) {
  const sp = await searchParams;
  const severityParam = typeof sp.severity === "string" ? sp.severity : undefined;
  const severity = SEVERITIES.includes(severityParam as (typeof SEVERITIES)[number])
    ? (severityParam as (typeof SEVERITIES)[number])
    : undefined;
  const sortParam = typeof sp.sort === "string" ? sp.sort : undefined;
  const sort = SORTS.some((s) => s.value === sortParam) ? (sortParam as CircularDonationSort) : "severity";
  const page = Math.max(1, Number(sp.page) || 1);

  const summary = getCircularDonationSummary();
  const signals = getCircularDonationSignals({
    severity, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
  });
  const shownCount = severity ? (summary.bySeverity[severity] ?? 0) : summary.total;
  const totalPages = Math.max(1, Math.ceil(shownCount / PAGE_SIZE));

  const hrefFor = (params: Record<string, string | undefined>) => {
    const usp = new URLSearchParams();
    if (params.severity) usp.set("severity", params.severity);
    if (params.sort && params.sort !== "severity") usp.set("sort", params.sort);
    if (params.page && params.page !== "1") usp.set("page", params.page);
    const qs = usp.toString();
    return `/sinais/doacao-circular${qs ? `?${qs}` : ""}`;
  };

  return (
    <main className="min-h-screen">
      <header className="flex flex-none items-center gap-4 border-b border-white/[0.07] px-6 py-3">
        <Link href="/" className="mono-label hover:text-white/60">
          ← início
        </Link>
        <div className="h-4 w-px bg-white/10" />
        <div className="mono-label !text-white/45">sinais · doação circular</div>
      </header>

      <section className="border-b border-white/[0.07] px-6 py-14 sm:px-14">
        <div className="mono-label">
          elosys/rules/circular_donations.py · algoritmo local (Tarjan SCC + DFS limitado em profundidade)
        </div>
        <h1 className="mt-3 text-[28px] leading-tight font-light tracking-tight sm:text-[34px]">
          Loops de doação/despesa entre campanhas
        </h1>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-white/45">
          Cada sinal abaixo é um ciclo real de movimentação encontrado na base inteira: dinheiro
          que saiu de uma campanha e, seguindo doações e despesas, voltou pra mesma cadeia.{" "}
          <strong className="text-white/60">Isso é indício, não prova</strong> — pode ser
          coincidência entre campanhas de coligação, ressarcimento, ou merecer uma checagem manual
          mais de perto.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[11px] text-white/45">
          <span>
            <span className="text-foreground">{summary.total.toLocaleString("pt-BR")}</span> sinais total
          </span>
          {SEVERITIES.map((sv) =>
            summary.bySeverity[sv] ? (
              <span key={sv}>
                <span className={SEVERITY_COLOR[sv].split(" ")[0]}>
                  {summary.bySeverity[sv].toLocaleString("pt-BR")}
                </span>{" "}
                {SEVERITY_LABEL[sv]}
              </span>
            ) : null
          )}
          {summary.maxDepth != null ? <span>profundidade máxima: {summary.maxDepth} nós</span> : null}
          {summary.runAt ? <span>última execução: {summary.runAt}</span> : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link
            href={hrefFor({ severity: undefined, sort })}
            className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase ${
              !severity ? "border-foreground text-foreground" : "border-white/15 text-white/45 hover:text-white/70"
            }`}
          >
            todas
          </Link>
          {SEVERITIES.map((sv) => (
            <Link
              key={sv}
              href={hrefFor({ severity: sv, sort })}
              className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase ${
                severity === sv ? SEVERITY_COLOR[sv] : "border-white/15 text-white/45 hover:text-white/70"
              }`}
            >
              {SEVERITY_LABEL[sv]}
            </Link>
          ))}
          <div className="mx-2 h-4 w-px bg-white/10" />
          <span className="mono-label !text-white/35">ordenar por</span>
          {SORTS.map((s) => (
            <Link
              key={s.value}
              href={hrefFor({ severity, sort: s.value })}
              className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase ${
                sort === s.value ? "border-foreground text-foreground" : "border-white/15 text-white/45 hover:text-white/70"
              }`}
            >
              {s.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="px-6 py-10 sm:px-14">
        {summary.total === 0 ? (
          <div className="py-10 text-center font-mono text-[11px] text-white/35">
            nenhum sinal ainda — rode <code>elosys rule-circular-donations --db elosys.db</code>.
          </div>
        ) : signals.length === 0 ? (
          <div className="py-10 text-center font-mono text-[11px] text-white/35">
            sem sinais para esse filtro.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {signals.map((s) => {
              const addParam = s.actors.map((a) => a.cpfCnpj).join(",");
              return (
                <div
                  key={s.id}
                  className="rounded-sm border border-white/[0.08] bg-white/[0.02] p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={`rounded-sm border px-2 py-0.5 font-mono text-[9px] tracking-[0.1em] uppercase ${SEVERITY_COLOR[s.severity]}`}
                      >
                        severidade {SEVERITY_LABEL[s.severity] ?? s.severity}
                      </span>
                      <span className="font-mono text-[11px] text-elo-amber">{formatBRL(s.amountCents)}</span>
                      <span className="font-mono text-[10px] text-white/40">
                        {s.pathLength} {s.pathLength === 1 ? "nó" : "nós"}
                      </span>
                      {s.aiReview ? (
                        <span
                          className={`rounded-sm border px-2 py-0.5 font-mono text-[9px] tracking-[0.1em] uppercase ${
                            s.aiReview.verdict === "bizarro"
                              ? "border-elo-red/40 text-elo-red"
                              : s.aiReview.verdict === "inconclusivo"
                                ? "border-elo-amber/40 text-elo-amber"
                                : "border-white/20 text-white/50"
                          }`}
                        >
                          IA: {s.aiReview.verdict === "plausivel" ? "plausível" : s.aiReview.verdict}
                        </span>
                      ) : null}
                    </div>
                    {addParam ? (
                      <Link
                        href={`/grafo?add=${encodeURIComponent(addParam)}`}
                        className="mono-label !text-white/45 hover:!text-elo-amber"
                      >
                        ver no grafo →
                      </Link>
                    ) : null}
                  </div>

                  <p className="mt-3 text-[13px] leading-relaxed text-white/70">{s.explanation}</p>
                  {s.aiReview ? (
                    <p className="mt-2 border-l-2 border-white/10 pl-3 text-[12px] leading-relaxed text-white/45">
                      <span className="mono-label !text-white/30">IA · {s.aiReview.model}</span>{" "}
                      {s.aiReview.explanation}
                    </p>
                  ) : null}

                  {s.actors.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {s.actors.map((a) => {
                        const href = entityHref(a.cpfCnpj);
                        const chip = (
                          <span className="rounded-sm border border-white/12 px-2 py-1 font-mono text-[10px] text-white/60">
                            {a.label !== a.cpfCnpj ? `${a.label} · ` : ""}
                            {formatCpfCnpj(a.cpfCnpj)}
                          </span>
                        );
                        return href ? (
                          <Link key={a.cpfCnpj} href={href} className="hover:opacity-70">
                            {chip}
                          </Link>
                        ) : (
                          <span key={a.cpfCnpj}>{chip}</span>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 ? (
          <div className="mt-8 flex items-center justify-center gap-4 font-mono text-[11px] text-white/45">
            {page > 1 ? (
              <Link href={hrefFor({ severity, sort, page: String(page - 1) })} className="hover:text-white/70">
                ← anterior
              </Link>
            ) : (
              <span className="text-white/20">← anterior</span>
            )}
            <span>
              página {page} de {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={hrefFor({ severity, sort, page: String(page + 1) })} className="hover:text-white/70">
                próxima →
              </Link>
            ) : (
              <span className="text-white/20">próxima →</span>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
