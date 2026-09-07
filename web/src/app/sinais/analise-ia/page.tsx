import Link from "next/link";
import { getAiReviewCount, getAiReviews, getAiReviewSummary, type AiVerdict } from "@/lib/queries";
import { formatBRL } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const VERDICTS: AiVerdict[] = ["bizarro", "inconclusivo", "plausivel"];
const VERDICT_LABEL: Record<AiVerdict, string> = {
  bizarro: "bizarro",
  inconclusivo: "inconclusivo",
  plausivel: "plausível",
};
const VERDICT_COLOR: Record<AiVerdict, string> = {
  bizarro: "text-elo-red border-elo-red/40",
  inconclusivo: "text-elo-amber border-elo-amber/40",
  plausivel: "text-white/50 border-white/20",
};
const RULES = [
  { value: "circular_donations", label: "doação circular" },
  { value: "disproportionate_expense", label: "despesa desproporcional" },
];

export default async function AnaliseIaPage({ searchParams }: PageProps<"/sinais/analise-ia">) {
  const sp = await searchParams;
  const verdictParam = typeof sp.verdict === "string" ? sp.verdict : undefined;
  const verdict = VERDICTS.includes(verdictParam as AiVerdict) ? (verdictParam as AiVerdict) : undefined;
  const ruleParam = typeof sp.rule === "string" ? sp.rule : undefined;
  const rule = RULES.some((r) => r.value === ruleParam) ? ruleParam : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const summary = getAiReviewSummary();
  const count = getAiReviewCount({ verdict, rule });
  const reviews = getAiReviews({ verdict, rule, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const hrefFor = (p: Record<string, string | undefined>) => {
    const usp = new URLSearchParams();
    if (p.verdict) usp.set("verdict", p.verdict);
    if (p.rule) usp.set("rule", p.rule);
    if (p.page && p.page !== "1") usp.set("page", p.page);
    const qs = usp.toString();
    return `/sinais/analise-ia${qs ? `?${qs}` : ""}`;
  };

  return (
    <main className="min-h-screen">
      <header className="flex flex-none items-center gap-4 border-b border-white/[0.07] px-6 py-3">
        <Link href="/" className="mono-label hover:text-white/60">
          ← início
        </Link>
        <div className="h-4 w-px bg-white/10" />
        <div className="mono-label !text-white/45">sinais · análise de IA</div>
      </header>

      <section className="border-b border-white/[0.07] px-6 py-14 sm:px-14">
        <div className="mono-label">
          elosys/rules/ai_review.py · segunda opinião de LLM {summary.model ? `(${summary.model})` : ""}
        </div>
        <h1 className="mt-3 text-[28px] leading-tight font-light tracking-tight sm:text-[34px]">
          O que a IA achou estranho
        </h1>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-white/45">
          Cada sinal de <strong className="text-white/60">doação circular</strong> ou{" "}
          <strong className="text-white/60">despesa desproporcional</strong> foi passado pra um modelo
          barato (DeepSeek) com os fatos, e ele respondeu se aquilo é <em>rotineiro</em> ou{" "}
          <em>genuinamente estranho</em>. A resposta, a explicação e os fatos que o modelo citou ficam
          salvos junto do sinal.{" "}
          <strong className="text-white/60">Continua sendo indício, não prova</strong> — agora com a
          opinião de uma máquina anexada, que também pode estar errada.
        </p>

        {summary.total === 0 ? null : (
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[11px] text-white/45">
            <span>
              <span className="text-foreground">{summary.total.toLocaleString("pt-BR")}</span> revisados
            </span>
            {VERDICTS.map((v) =>
              summary.byVerdict[v] ? (
                <span key={v}>
                  <span className={VERDICT_COLOR[v].split(" ")[0]}>
                    {summary.byVerdict[v].toLocaleString("pt-BR")}
                  </span>{" "}
                  {VERDICT_LABEL[v]}
                </span>
              ) : null
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link
            href={hrefFor({ rule })}
            className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase ${
              !verdict ? "border-foreground text-foreground" : "border-white/15 text-white/45 hover:text-white/70"
            }`}
          >
            todos
          </Link>
          {VERDICTS.map((v) => (
            <Link
              key={v}
              href={hrefFor({ verdict: v, rule })}
              className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase ${
                verdict === v ? VERDICT_COLOR[v] : "border-white/15 text-white/45 hover:text-white/70"
              }`}
            >
              {VERDICT_LABEL[v]}
            </Link>
          ))}
          <div className="mx-2 h-4 w-px bg-white/10" />
          <Link
            href={hrefFor({ verdict })}
            className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase ${
              !rule ? "border-foreground text-foreground" : "border-white/15 text-white/45 hover:text-white/70"
            }`}
          >
            toda regra
          </Link>
          {RULES.map((rr) => (
            <Link
              key={rr.value}
              href={hrefFor({ verdict, rule: rr.value })}
              className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase ${
                rule === rr.value ? "border-foreground text-foreground" : "border-white/15 text-white/45 hover:text-white/70"
              }`}
            >
              {rr.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="px-6 py-10 sm:px-14">
        {summary.total === 0 ? (
          <div className="py-10 text-center font-mono text-[11px] text-white/35">
            nenhuma revisão ainda — rode <code>elosys ai-review --db elosys.db --limit 100</code> (precisa
            de <code>DEEPSEEK_API_KEY</code>).
          </div>
        ) : reviews.length === 0 ? (
          <div className="py-10 text-center font-mono text-[11px] text-white/35">sem revisões para esse filtro.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {reviews.map((r) => (
              <div key={r.signalId} className="rounded-sm border border-white/[0.08] bg-white/[0.02] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`rounded-sm border px-2 py-0.5 font-mono text-[9px] tracking-[0.1em] uppercase ${VERDICT_COLOR[r.verdict]}`}
                    >
                      IA: {VERDICT_LABEL[r.verdict]}
                      {r.confidence ? ` · confiança ${r.confidence}` : ""}
                    </span>
                    <span className="mono-label !text-white/35">{r.ruleLabel}</span>
                    {r.signalAmountCents > 0 ? (
                      <span className="font-mono text-[11px] text-elo-amber">{formatBRL(r.signalAmountCents)}</span>
                    ) : null}
                  </div>
                  {r.graphIds && r.graphIds.length > 0 ? (
                    <Link
                      href={`/grafo?add=${encodeURIComponent(r.graphIds.join(","))}`}
                      className="mono-label !text-white/45 hover:!text-elo-amber"
                    >
                      ver no grafo →
                    </Link>
                  ) : null}
                </div>

                <p className="mt-3 text-[13px] leading-relaxed text-white/75">{r.explanation}</p>

                {r.facts.length > 0 ? (
                  <ul className="mt-3 flex flex-col gap-1 text-[12px] text-white/50">
                    {r.facts.map((f, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-white/25">–</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <details className="mt-3">
                  <summary className="mono-label cursor-pointer !text-white/35 hover:!text-white/55">
                    sinal original
                  </summary>
                  <p className="mt-2 text-[12px] leading-relaxed text-white/45">{r.signalExplanation}</p>
                </details>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 ? (
          <div className="mt-8 flex items-center justify-center gap-4 font-mono text-[11px] text-white/45">
            {page > 1 ? (
              <Link href={hrefFor({ verdict, rule, page: String(page - 1) })} className="hover:text-white/70">
                ← anterior
              </Link>
            ) : (
              <span className="text-white/20">← anterior</span>
            )}
            <span>
              página {page} de {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={hrefFor({ verdict, rule, page: String(page + 1) })} className="hover:text-white/70">
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
