import Link from "next/link";
import { getEarmarkPayments, EARMARK_PAGE_SIZE } from "@/lib/queries";
import { formatBRL, formatCnpj } from "@/lib/format";
import { PageHeader } from "@/components/shell/shell-context";
import { PaginationLinks } from "@/components/ui/pagination-links";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchAvatar } from "@/components/search-avatar";

export const dynamic = "force-dynamic";

export default async function EmendasPage({ searchParams }: PageProps<"/emendas">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const { rows, total } = getEarmarkPayments({ page, q, order: "desc" });
  const totalPages = Math.max(1, Math.ceil(total / EARMARK_PAGE_SIZE));

  const hrefFor = (p: Record<string, string | undefined>) => {
    const usp = new URLSearchParams();
    if (p.q) usp.set("q", p.q);
    if (p.page && p.page !== "1") usp.set("page", p.page);
    const s = usp.toString();
    return `/emendas${s ? `?${s}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader group="EloSys" current="Emendas Parlamentares" />

      <section>
        <div className="mono-label">Portal da Transparência (CGU) · elosys/transparencia/earmarks.py</div>
        <h1 className="mt-3 text-[26px] leading-tight font-medium tracking-tight">
          Emendas parlamentares — quem fez, quanto, pra qual empresa
        </h1>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Toda emenda ao orçamento federal (2014-atual) cujo favorecido é uma empresa (pessoa
          jurídica) — não um município, órgão público ou pessoa física. O autor é identificado só
          por <strong style={{ color: "var(--fg-2)" }}>nome</strong>, não por CPF (a fonte não tem
          esse vínculo): é um cruzamento provável, não uma identidade confirmada.
        </p>

        <div className="mono mt-6" style={{ fontSize: 11, color: "var(--muted)" }}>
          <span style={{ color: "var(--fg-1)" }}>{total.toLocaleString("pt-BR")}</span> emendas pra
          empresas
        </div>

        <form className="mt-5 flex flex-wrap items-center gap-2" action="/emendas">
          <div className="input" style={{ width: 280 }}>
            <input name="q" defaultValue={q} placeholder="buscar autor ou empresa…" />
          </div>
        </form>
      </section>

      <section>
        {rows.length === 0 ? (
          <EmptyState icon="◌" title={q ? "nada para essa busca." : "nenhuma emenda pra empresa encontrada."} />
        ) : (
          <div className="table-wrap">
            <div className="overflow-x-auto">
              <table className="table min-w-[680px]">
                <thead>
                  <tr>
                    <th>autor da emenda</th>
                    <th>empresa</th>
                    <th className="text-right">valor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.earmarkCode}-${r.companyCnpj}`}>
                      <td>
                        <div className="flex items-center gap-2">
                          {r.authorPersonId != null ? (
                            <SearchAvatar photoUrl={r.authorPhotoUrl} name={r.authorName ?? "?"} />
                          ) : null}
                          <div>
                            {r.authorPersonId != null ? (
                              <Link href={`/politico/${r.authorPersonId}`} className="hover:underline">
                                {r.authorName ?? "autor não identificado"}
                              </Link>
                            ) : (
                              <span>{r.authorName ?? "autor não identificado"}</span>
                            )}
                            {r.year ? (
                              <div className="mono" style={{ fontSize: 9.5, color: "var(--muted-2)" }}>{r.year}</div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[240px]">
                        <Link href={`/cnpj/${r.companyCnpj}`} className="hover:underline">
                          {r.companyName ?? formatCnpj(r.companyCnpj)}
                        </Link>
                        <div className="mono" style={{ fontSize: 9.5, color: "var(--muted-2)" }}>
                          {formatCnpj(r.companyCnpj)}
                        </div>
                      </td>
                      <td className="num">{formatBRL(r.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 ? (
              <div className="table-footer">
                <PaginationLinks page={page} totalPages={totalPages} makeHref={(p) => hrefFor({ q, page: String(p) })} />
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
