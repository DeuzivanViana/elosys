import Link from "next/link";
import {
  DISCOURSE_GROUP_CATEGORIES,
  DISCOURSE_OTHER_CATEGORIES,
  getDiscourseCount,
  getDiscourseSignals,
  getDiscourseSummary,
  type DiscourseSeverity,
} from "@/lib/queries";
import { PageHeader } from "@/components/shell/shell-context";
import { PaginationLinks } from "@/components/ui/pagination-links";
import { EmptyState } from "@/components/ui/empty-state";

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

const SEVERITY_CLASS: Record<DiscourseSeverity, string> = {
  high: "signal--high",
  medium: "signal--medium",
  low: "signal--low",
};
const SEVERITY_BADGE: Record<DiscourseSeverity, string> = {
  high: "badge--red",
  medium: "badge--accent",
  low: "",
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
    <div className="flex flex-col gap-8">
      <PageHeader group="Sinais" current="Discurso em rede social" />

      <section>
        <div className="mono-label">
          elosys/social + elosys/rules/social_review.py · contas de X declaradas ao TSE
        </div>
        <h1 className="mt-3 text-[26px] leading-tight font-medium tracking-tight">
          Discurso pejorativo em posts públicos
        </h1>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Posts e respostas de contas de X <strong style={{ color: "var(--fg-2)" }}>declaradas pelo próprio
          candidato ao TSE</strong>, filtrados por um léxico de ~470 termos que <em>podem</em> ser
          pejorativos e depois lidos por um modelo (DeepSeek) que decide, pelo contexto, se aquilo
          ataca um grupo protegido ou uma pessoa — ou se é uso legítimo (citação, denúncia, palavra
          literal). <strong style={{ color: "var(--fg-2)" }}>Classificação automática, pode errar</strong> — o
          trecho literal e o link pro tweet estão sempre à vista. Indício, não prova.
        </p>

        {summary.total === 0 ? null : (
          <div className="mono mt-6 flex flex-wrap items-center gap-x-6 gap-y-2" style={{ fontSize: 11, color: "var(--muted)" }}>
            <span>
              <span style={{ color: "var(--fg-1)" }}>{summary.reviewed.toLocaleString("pt-BR")}</span> posts revisados
            </span>
            <span>
              <span style={{ color: "var(--accent-2)" }}>{summary.total.toLocaleString("pt-BR")}</span> sinalizados
            </span>
            <span>
              <span style={{ color: "var(--fg-1)" }}>{summary.accounts.toLocaleString("pt-BR")}</span> contas
            </span>
            {(["high", "medium", "low"] as DiscourseSeverity[]).map((s) =>
              summary.bySeverity[s] ? (
                <span key={s}>{summary.bySeverity[s]} {SEVERITY_LABEL[s]}</span>
              ) : null
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link href={hrefFor({ severidade: severity, q })} className={`btn${!category && !group ? " btn--primary" : ""}`}>
            todos ({summary.total})
          </Link>
          <Link href={hrefFor({ grupo: "1", severidade: severity, q })} className={`btn${group ? " btn--primary" : ""}`}>
            só grupo protegido ({groupTotal})
          </Link>
          <div className="mx-1 h-4 w-px" style={{ background: "var(--border-1)" }} />
          {ALL_CATEGORIES.map((c) =>
            summary.byCategory[c] ? (
              <Link key={c} href={hrefFor({ categoria: c, severidade: severity, q })} className={`btn${category === c ? " btn--primary" : ""}`}>
                {CATEGORY_LABEL[c]} ({summary.byCategory[c]})
              </Link>
            ) : null
          )}
        </div>

        <form method="get" className="mt-4 flex flex-wrap items-center gap-2">
          {category ? <input type="hidden" name="categoria" value={category} /> : null}
          {group ? <input type="hidden" name="grupo" value="1" /> : null}
          {severity ? <input type="hidden" name="severidade" value={severity} /> : null}
          <div className="input" style={{ width: 256 }}>
            <input type="search" name="q" defaultValue={q ?? ""} placeholder="buscar por texto, nome ou @" />
          </div>
          <button type="submit" className="btn">
            buscar
          </button>
          {q ? (
            <Link href={hrefFor({ categoria: category, grupo: group ? "1" : undefined, severidade: severity })} className="mono-label hover:text-[var(--muted)]">
              limpar
            </Link>
          ) : null}
        </form>
      </section>

      <section>
        {summary.reviewed === 0 ? (
          <EmptyState
            icon="◌"
            title="nenhum post revisado ainda"
            hint={
              <>
                <code>elosys social-x</code> e <code>elosys social-review</code> (precisa de{" "}
                <code>APIFY_TOKEN</code> e <code>DEEPSEEK_API_KEY</code>)
              </>
            }
          />
        ) : signals.length === 0 ? (
          <EmptyState icon="◌" title="nenhum sinal para esse filtro." />
        ) : (
          <div className="flex flex-col gap-3">
            {signals.map((s) => (
              <article key={s.postId} className={`signal ${s.severity ? SEVERITY_CLASS[s.severity] : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {s.severity ? (
                      <span className={`badge ${SEVERITY_BADGE[s.severity]}`}>severidade {SEVERITY_LABEL[s.severity]}</span>
                    ) : null}
                    {s.categories.map((c) => (
                      <span key={c} className="badge">
                        {CATEGORY_LABEL[c] ?? c}
                      </span>
                    ))}
                    <span className="mono-label">{s.kind}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="mono-label">{fmtDate(s.postedAt)}</span>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="mono-label hover:text-[var(--accent-2)]">
                        tweet ↗
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                  {s.personId ? (
                    <Link href={`/politico/${s.personId}`} style={{ color: "var(--fg-2)" }} className="hover:text-[var(--accent-2)]">
                      {s.personName ?? `@${s.handle}`}
                    </Link>
                  ) : (
                    <span style={{ color: "var(--fg-2)" }}>{s.personName ?? `@${s.handle}`}</span>
                  )}
                  <span className="mono" style={{ fontSize: 11, color: "var(--muted-2)" }}>
                    @{s.handle}
                    {s.party ? ` · ${s.party}` : ""}
                    {s.state ? `/${s.state}` : ""}
                  </span>
                  {s.replyToHandle ? (
                    <span className="mono" style={{ fontSize: 11, color: "var(--muted-2)" }}>resposta a @{s.replyToHandle}</span>
                  ) : null}
                </div>

                <blockquote className="mt-3 border-l-2 pl-3 text-[14.5px] leading-relaxed whitespace-pre-wrap" style={{ borderColor: "var(--border-1)", color: "var(--fg-2)" }}>
                  {s.text}
                </blockquote>

                {s.quote ? (
                  <p className="mt-3 text-[12px]" style={{ color: "var(--muted)" }}>
                    <span style={{ color: "var(--muted-2)" }}>trecho apontado: </span>
                    <span style={{ color: "var(--accent-2)" }}>&ldquo;{s.quote}&rdquo;</span>
                  </p>
                ) : null}
                {s.explanation ? (
                  <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>{s.explanation}</p>
                ) : null}
                {s.matchedTerms.length > 0 ? (
                  <p className="mt-2 mono" style={{ fontSize: 10, color: "var(--muted-2)" }}>
                    termos do filtro: {s.matchedTerms.join(", ")}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}

        {totalPages > 1 ? (
          <div className="mt-8 flex items-center justify-center border-t border-[var(--border-1)] pt-4">
            <PaginationLinks
              page={page}
              totalPages={totalPages}
              makeHref={(p) =>
                hrefFor({ categoria: category, grupo: group ? "1" : undefined, severidade: severity, q, page: String(p) })
              }
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
