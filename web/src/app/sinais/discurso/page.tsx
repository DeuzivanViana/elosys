import Link from "next/link";
import {
  DISCOURSE_GROUP_CATEGORIES,
  DISCOURSE_OTHER_CATEGORIES,
  getDiscourseCount,
  getDiscourseSignals,
  getDiscourseSummary,
  type DiscourseSeverity,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const CATEGORY_LABEL: Record<string, string> = {
  lgbtfobia: "LGBTfobia",
  racismo: "racismo",
  misoginia: "misoginia",
  capacitismo: "capacitismo",
  xenofobia: "xenofobia",
  regionalismo: "regionalismo",
  aporofobia: "aporofobia",
  gordofobia: "gordofobia",
  antissemitismo: "antissemitismo",
  intolerancia_religiosa: "intolerância religiosa",
  etarismo_saude: "etarismo / saúde",
  desumanizacao: "desumanização",
  xingamento_pessoal: "xingamento pessoal",
};

const SEVERITY_COLOR: Record<DiscourseSeverity, string> = {
  high: "text-elo-red border-elo-red/40",
  medium: "text-elo-amber border-elo-amber/40",
  low: "text-white/50 border-white/20",
};
const SEVERITY_LABEL: Record<DiscourseSeverity, string> = { high: "alta", medium: "média", low: "baixa" };

const ALL_CATEGORIES = [...DISCOURSE_GROUP_CATEGORIES, ...DISCOURSE_OTHER_CATEGORIES];

function fmtDate(raw: string | null): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function DiscursoPage({ searchParams }: PageProps<"/sinais/discurso">) {
  const sp = await searchParams;
  const catParam = typeof sp.categoria === "string" ? sp.categoria : undefined;
  const category = ALL_CATEGORIES.includes(catParam as never) ? catParam : undefined;
  const group = sp.grupo === "1" && !category;
  const sevParam = typeof sp.severidade === "string" ? sp.severidade : undefined;
  const severity = ["high", "medium", "low"].includes(sevParam ?? "") ? sevParam : undefined;
  const q = typeof sp.q === "string" ? sp.q.trim() || undefined : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const summary = getDiscourseSummary();
  const opts = { category, group, severity, q };
  const count = getDiscourseCount(opts);
  const signals = getDiscourseSignals({ ...opts, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const groupTotal = DISCOURSE_GROUP_CATEGORIES.reduce((s, c) => s + (summary.byCategory[c] ?? 0), 0);

  const hrefFor = (p: Record<string, string | undefined>) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v) usp.set(k, v);
    const qs = usp.toString();
    return `/sinais/discurso${qs ? `?${qs}` : ""}`;
  };

  return (
    <main className="min-h-screen">
      <header className="flex flex-none items-center gap-4 border-b border-white/[0.07] px-6 py-3">
        <Link href="/" className="mono-label hover:text-white/60">
          ← início
        </Link>
        <div className="h-4 w-px bg-white/10" />
        <div className="mono-label !text-white/45">sinais · discurso em rede social</div>
      </header>

      <section className="border-b border-white/[0.07] px-6 py-14 sm:px-14">
        <div className="mono-label">
          elosys/social + elosys/rules/social_review.py · contas de X declaradas ao TSE
        </div>
        <h1 className="mt-3 text-[28px] leading-tight font-light tracking-tight sm:text-[34px]">
          Discurso pejorativo em posts públicos
        </h1>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-white/45">
          Posts e respostas de contas de X <strong className="text-white/60">declaradas pelo próprio
          candidato ao TSE</strong>, filtrados por um léxico de ~470 termos que <em>podem</em> ser
          pejorativos e depois lidos por um modelo (DeepSeek) que decide, pelo contexto, se aquilo
          ataca um grupo protegido ou uma pessoa — ou se é uso legítimo (citação, denúncia, palavra
          literal). <strong className="text-white/60">Classificação automática, pode errar</strong> — o
          trecho literal e o link pro tweet estão sempre à vista. Indício, não prova.
        </p>

        {summary.total === 0 ? null : (
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[11px] text-white/45">
            <span>
              <span className="text-foreground">{summary.reviewed.toLocaleString("pt-BR")}</span> posts
              revisados
            </span>
            <span>
              <span className="text-elo-amber">{summary.total.toLocaleString("pt-BR")}</span> sinalizados
            </span>
            <span>
              <span className="text-foreground">{summary.accounts.toLocaleString("pt-BR")}</span> contas
            </span>
            {(["high", "medium", "low"] as DiscourseSeverity[]).map((s) =>
              summary.bySeverity[s] ? (
                <span key={s}>
                  <span className={SEVERITY_COLOR[s].split(" ")[0]}>{summary.bySeverity[s]}</span>{" "}
                  {SEVERITY_LABEL[s]}
                </span>
              ) : null
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link
            href={hrefFor({ severidade: severity, q })}
            className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase ${
              !category && !group ? "border-foreground text-foreground" : "border-white/15 text-white/45 hover:text-white/70"
            }`}
          >
            todos ({summary.total})
          </Link>
          <Link
            href={hrefFor({ grupo: "1", severidade: severity, q })}
            className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase ${
              group ? "border-foreground text-foreground" : "border-white/15 text-white/45 hover:text-white/70"
            }`}
          >
            só grupo protegido ({groupTotal})
          </Link>
          <div className="mx-1 h-4 w-px bg-white/10" />
          {ALL_CATEGORIES.map((c) =>
            summary.byCategory[c] ? (
              <Link
                key={c}
                href={hrefFor({ categoria: c, severidade: severity, q })}
                className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase ${
                  category === c ? "border-foreground text-foreground" : "border-white/15 text-white/45 hover:text-white/70"
                }`}
              >
                {CATEGORY_LABEL[c]} ({summary.byCategory[c]})
              </Link>
            ) : null
          )}
        </div>

        <form method="get" className="mt-4 flex flex-wrap items-center gap-2">
          {category ? <input type="hidden" name="categoria" value={category} /> : null}
          {group ? <input type="hidden" name="grupo" value="1" /> : null}
          {severity ? <input type="hidden" name="severidade" value={severity} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="buscar por texto, nome ou @"
            className="w-64 rounded-sm border border-white/15 bg-transparent px-3 py-1.5 font-mono text-[11px] text-white/80 placeholder:text-white/25 focus:border-white/40 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-sm border border-white/15 px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] text-white/45 uppercase hover:text-white/70"
          >
            buscar
          </button>
          {q ? (
            <Link href={hrefFor({ categoria: category, grupo: group ? "1" : undefined, severidade: severity })} className="mono-label hover:text-white/60">
              limpar
            </Link>
          ) : null}
        </form>
      </section>

      <section className="px-6 py-10 sm:px-14">
        {summary.reviewed === 0 ? (
          <div className="py-10 text-center font-mono text-[11px] text-white/35">
            nenhum post revisado ainda — rode <code>elosys social-x</code> e{" "}
            <code>elosys social-review</code> (precisa de <code>APIFY_TOKEN</code> e{" "}
            <code>DEEPSEEK_API_KEY</code>).
          </div>
        ) : signals.length === 0 ? (
          <div className="py-10 text-center font-mono text-[11px] text-white/35">
            nenhum sinal para esse filtro.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {signals.map((s) => (
              <div key={s.postId} className="rounded-sm border border-white/[0.08] bg-white/[0.02] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {s.severity ? (
                      <span
                        className={`rounded-sm border px-2 py-0.5 font-mono text-[9px] tracking-[0.1em] uppercase ${SEVERITY_COLOR[s.severity]}`}
                      >
                        {SEVERITY_LABEL[s.severity]}
                      </span>
                    ) : null}
                    {s.categories.map((c) => (
                      <span key={c} className="mono-label !text-white/40">
                        {CATEGORY_LABEL[c] ?? c}
                      </span>
                    ))}
                    <span className="mono-label !text-white/25">{s.kind}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="mono-label !text-white/30">{fmtDate(s.postedAt)}</span>
                    {s.url ? (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mono-label !text-white/45 hover:!text-elo-amber"
                      >
                        tweet ↗
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                  {s.personId ? (
                    <Link href={`/politico/${s.personId}`} className="text-white/80 hover:text-elo-amber">
                      {s.personName ?? `@${s.handle}`}
                    </Link>
                  ) : (
                    <span className="text-white/80">{s.personName ?? `@${s.handle}`}</span>
                  )}
                  <span className="font-mono text-[11px] text-white/35">
                    @{s.handle}
                    {s.party ? ` · ${s.party}` : ""}
                    {s.state ? `/${s.state}` : ""}
                  </span>
                  {s.replyToHandle ? (
                    <span className="font-mono text-[11px] text-white/25">resposta a @{s.replyToHandle}</span>
                  ) : null}
                </div>

                <blockquote className="mt-3 border-l-2 border-white/15 pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-white/75">
                  {s.text}
                </blockquote>

                {s.quote ? (
                  <p className="mt-3 text-[12px] text-white/50">
                    <span className="text-white/30">trecho apontado: </span>
                    <span className="text-elo-amber/90">“{s.quote}”</span>
                  </p>
                ) : null}
                {s.explanation ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-white/45">{s.explanation}</p>
                ) : null}
                {s.matchedTerms.length > 0 ? (
                  <p className="mt-2 font-mono text-[10px] text-white/25">
                    termos do filtro: {s.matchedTerms.join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 ? (
          <div className="mt-8 flex items-center justify-center gap-4 font-mono text-[11px] text-white/45">
            {page > 1 ? (
              <Link
                href={hrefFor({ categoria: category, grupo: group ? "1" : undefined, severidade: severity, q, page: String(page - 1) })}
                className="hover:text-white/70"
              >
                ← anterior
              </Link>
            ) : (
              <span className="text-white/20">← anterior</span>
            )}
            <span>
              página {page} de {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={hrefFor({ categoria: category, grupo: group ? "1" : undefined, severidade: severity, q, page: String(page + 1) })}
                className="hover:text-white/70"
              >
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
