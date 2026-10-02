import Link from "next/link";
import { getCircularDonationSignals, getCircularDonationSummary, type CircularDonationSort } from "@/lib/queries";
import { entityHref, formatBRL, formatCpfCnpj } from "@/lib/format";
import { PageHeader } from "@/components/shell/shell-context";
import { PaginationLinks } from "@/components/ui/pagination-links";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const SEVERITIES = ["high", "medium", "low"] as const;
const SEVERITY_LABEL: Record<string, string> = { high: "alta", medium: "média", low: "baixa" };
const SEVERITY_BADGE: Record<string, string> = { high: "badge--red", medium: "badge--accent", low: "" };
const SEVERITY_CLASS: Record<string, string> = { high: "signal--high", medium: "signal--medium", low: "signal--low" };
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
    <div className="flex flex-col gap-8">
      <PageHeader group="Sinais" current="Doação circular" />

      <section>
        <h1 className="text-[26px] leading-tight font-medium tracking-tight">
          Loops de doação/despesa entre campanhas
        </h1>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Cada sinal abaixo é um ciclo real de movimentação encontrado na base inteira: dinheiro
          que saiu de uma campanha e, seguindo doações e despesas, voltou pra mesma cadeia.{" "}
          <strong style={{ color: "var(--fg-2)" }}>Isso é indício, não prova</strong> — pode ser
          coincidência entre campanhas de coligação, ressarcimento, ou merecer uma checagem manual
          mais de perto.
        </p>

        <div className="mono mt-6 flex flex-wrap items-center gap-x-6 gap-y-2" style={{ fontSize: 11, color: "var(--muted)" }}>
          <span>
            <span style={{ color: "var(--fg-1)" }}>{summary.total.toLocaleString("pt-BR")}</span> sinais total
          </span>
          {SEVERITIES.map((sv) =>
            summary.bySeverity[sv] ? (
              <span key={sv}>
                {summary.bySeverity[sv].toLocaleString("pt-BR")} {SEVERITY_LABEL[sv]}
              </span>
            ) : null
          )}
          {summary.maxDepth != null ? <span>profundidade máxima: {summary.maxDepth} nós</span> : null}
          {summary.runAt ? <span>última execução: {summary.runAt}</span> : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link href={hrefFor({ severity: undefined, sort })} className={`btn${!severity ? " btn--primary" : ""}`}>
            todas
          </Link>
          {SEVERITIES.map((sv) => (
            <Link key={sv} href={hrefFor({ severity: sv, sort })} className={`btn${severity === sv ? " btn--primary" : ""}`}>
              {SEVERITY_LABEL[sv]}
            </Link>
          ))}
          <div className="mx-2 h-4 w-px" style={{ background: "var(--border-1)" }} />
          <span className="label">ordenar por</span>
          {SORTS.map((s) => (
            <Link key={s.value} href={hrefFor({ severity, sort: s.value })} className={`btn${sort === s.value ? " btn--primary" : ""}`}>
              {s.label}
            </Link>
          ))}
        </div>
      </section>

      <section>
        {summary.total === 0 ? (
          <EmptyState
            icon="◌"
            title="nenhum sinal ainda"
            hint={<code>elosys rule-circular-donations --db elosys.db</code>}
          />
        ) : signals.length === 0 ? (
          <EmptyState icon="◌" title="sem sinais para esse filtro." />
        ) : (
          <div className="flex flex-col gap-3">
            {signals.map((s) => {
              const addParam = s.actors.map((a) => a.cpfCnpj).join(",");
              return (
                <article key={s.id} className={`signal ${SEVERITY_CLASS[s.severity] ?? ""}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`badge ${SEVERITY_BADGE[s.severity] ?? ""}`}>
                      severidade {SEVERITY_LABEL[s.severity] ?? s.severity}
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--muted-2)" }}>
                      {s.pathLength} {s.pathLength === 1 ? "nó" : "nós"}
                    </span>
                    {s.aiReview ? (
                      <span
                        className={`badge ${
                          s.aiReview.verdict === "bizarro" ? "badge--red" : s.aiReview.verdict === "inconclusivo" ? "badge--accent" : ""
                        }`}
                      >
                        IA: {s.aiReview.verdict === "plausivel" ? "plausível" : s.aiReview.verdict}
                      </span>
                    ) : null}
                    <span className="num" style={{ marginLeft: "auto", fontSize: 17 }}>{formatBRL(s.amountCents)}</span>
                  </div>

                  <p className="mt-3 text-[14.5px] leading-relaxed" style={{ color: "var(--fg-2)" }}>{s.explanation}</p>
                  {s.aiReview ? (
                    <p className="mt-2 border-l-2 pl-3 text-[12px] leading-relaxed" style={{ borderColor: "var(--border-1)", color: "var(--muted)" }}>
                      <span className="mono-label">IA · {s.aiReview.model}</span> {s.aiReview.explanation}
                    </p>
                  ) : null}

                  {s.actors.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {s.actors.map((a) => {
                        const href = entityHref(a.cpfCnpj);
                        const chip = (
                          <span className="mono rounded-[var(--r-sm)] border border-[var(--border-1)] px-2 py-1" style={{ fontSize: 10, color: "var(--muted)" }}>
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

                  {addParam ? (
                    <div className="mt-4">
                      <Link href={`/grafo?add=${encodeURIComponent(addParam)}`} className="btn btn--primary">
                        Ver no grafo
                      </Link>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}

        {totalPages > 1 ? (
          <div className="mt-8 flex items-center justify-center border-t border-[var(--border-1)] pt-4">
            <PaginationLinks
              page={page}
              totalPages={totalPages}
              makeHref={(p) => hrefFor({ severity, sort, page: String(p) })}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
