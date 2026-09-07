import Link from "next/link";
import {
  getSupplierPartnerCount,
  getSupplierPartners,
  getSupplierPartnerSummary,
  type SupplierPartnerFilter,
} from "@/lib/queries";
import { formatBRL, formatCnpj } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;
const FILTERS: Array<{ value: SupplierPartnerFilter; label: string }> = [
  { value: "all", label: "todos" },
  { value: "self", label: "pagou a própria empresa" },
  { value: "others", label: "outra campanha pagou" },
];

export default async function SocioFornecedorPage({ searchParams }: PageProps<"/sinais/socio-fornecedor">) {
  const sp = await searchParams;
  const filterParam = typeof sp.filtro === "string" ? sp.filtro : undefined;
  const filter = FILTERS.some((f) => f.value === filterParam)
    ? (filterParam as SupplierPartnerFilter)
    : "all";
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const summary = getSupplierPartnerSummary();
  const count = getSupplierPartnerCount({ filter, q });
  const rows = getSupplierPartners({ filter, q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const hrefFor = (p: Record<string, string | undefined>) => {
    const usp = new URLSearchParams();
    if (p.filtro && p.filtro !== "all") usp.set("filtro", p.filtro);
    if (p.q) usp.set("q", p.q);
    if (p.page && p.page !== "1") usp.set("page", p.page);
    const s = usp.toString();
    return `/sinais/socio-fornecedor${s ? `?${s}` : ""}`;
  };

  return (
    <main className="min-h-screen">
      <header className="flex flex-none items-center gap-4 border-b border-white/[0.07] px-6 py-3">
        <Link href="/" className="mono-label hover:text-white/60">
          ← início
        </Link>
        <div className="h-4 w-px bg-white/10" />
        <div className="mono-label !text-white/45">sinais · sócio de fornecedor</div>
      </header>

      <section className="border-b border-white/[0.07] px-6 py-14 sm:px-14">
        <div className="mono-label">
          elosys/rules/candidate_supplier_partner.py · cruzamento derivado
        </div>
        <h1 className="mt-3 text-[28px] leading-tight font-light tracking-tight sm:text-[34px]">
          Candidato sócio de uma empresa que recebeu dinheiro de campanha
        </h1>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-white/45">
          O candidato aparece no <strong className="text-white/60">quadro societário</strong> (Receita, via
          BrasilAPI) de uma empresa que recebeu pagamento de alguma campanha.{" "}
          <strong className="text-elo-amber">
            A correspondência NÃO é confirmada
          </strong>{" "}
          — a fonte mascara o CPF do sócio, então isso casa o nome normalizado com um candidato E os 6
          dígitos visíveis do CPF. Pode ser coincidência (duas pessoas, mesmo nome, mesmos 6 dígitos).
          Casos ambíguos (2+ pessoas batendo) são descartados. Indício, não prova.
        </p>

        {summary.total === 0 ? null : (
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[11px] text-white/45">
            <span>
              <span className="text-foreground">{summary.total.toLocaleString("pt-BR")}</span> vínculos possíveis
            </span>
            <span>
              <span className="text-elo-red">{summary.self.toLocaleString("pt-BR")}</span> pagaram a própria empresa
            </span>
            <span>
              <span className="text-elo-amber">{summary.others.toLocaleString("pt-BR")}</span> pagas por outra campanha
            </span>
            <span>
              <span className="text-foreground">{formatBRL(summary.totalCents)}</span> movimentados nessas empresas
            </span>
          </div>
        )}

        <form className="mt-6 flex flex-wrap items-center gap-2" action="/sinais/socio-fornecedor">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={hrefFor({ filtro: f.value, q })}
              className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase ${
                filter === f.value ? "border-foreground text-foreground" : "border-white/15 text-white/45 hover:text-white/70"
              }`}
            >
              {f.label}
            </Link>
          ))}
          <input
            name="q"
            defaultValue={q}
            placeholder="buscar candidato ou empresa…"
            className="ml-2 w-64 rounded-sm border border-white/12 bg-white/[0.04] px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-white/30 outline-none focus:border-white/30"
          />
          {filter !== "all" ? <input type="hidden" name="filtro" value={filter} /> : null}
        </form>
      </section>

      <section className="px-6 py-10 sm:px-14">
        {summary.total === 0 ? (
          <div className="py-10 text-center font-mono text-[11px] text-white/35">
            nenhum vínculo ainda — rode <code>elosys candidate-supplier-partner --db elosys.db</code> (precisa
            de quadro societário já coletado via <code>receita-cnpj</code>).
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center font-mono text-[11px] text-white/35">nada para esse filtro.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-white/[0.12] text-left font-mono text-[9px] tracking-[0.1em] text-white/35 uppercase">
                  <th className="py-2 pr-3 font-normal">candidato (sócio)</th>
                  <th className="py-2 pr-3 font-normal">empresa</th>
                  <th className="py-2 pr-3 font-normal">papel · desde</th>
                  <th className="py-2 pr-3 text-right font-normal">recebeu de campanhas</th>
                  <th className="py-2 text-right font-normal">quem pagou</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.personId}-${r.companyCnpj}`} className="border-b border-white/[0.06] align-top">
                    <td className="py-2.5 pr-3">
                      <Link href={`/politico/${r.personId}`} className="hover:text-elo-amber hover:underline">
                        {r.personName ?? "candidato"}
                      </Link>
                      <div className="mono-label !text-[8px] !text-white/25">correspondência não confirmada</div>
                    </td>
                    <td className="max-w-[240px] py-2.5 pr-3">
                      <Link href={`/cnpj/${r.companyCnpj}`} className="hover:text-elo-amber hover:underline">
                        {r.companyName ?? formatCnpj(r.companyCnpj)}
                      </Link>
                      <div className="font-mono text-[9.5px] text-white/30">{formatCnpj(r.companyCnpj)}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-white/55">
                      {r.partnerRole ?? "—"}
                      {r.partnerSince ? <span className="text-white/30"> · {r.partnerSince}</span> : null}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-elo-amber">
                      {formatBRL(r.paymentsTotalCents)}
                      <div className="text-[9.5px] text-white/30">
                        {r.paymentsCount.toLocaleString("pt-BR")} pagamentos
                      </div>
                    </td>
                    <td className="py-2.5 text-right font-mono text-[10.5px]">
                      {r.paidBySelf ? (
                        <span className="text-elo-red">a própria campanha</span>
                      ) : (
                        <span className="text-white/45">{r.payerCandidacies} campanha(s)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 ? (
          <div className="mt-8 flex items-center justify-center gap-4 font-mono text-[11px] text-white/45">
            {page > 1 ? (
              <Link href={hrefFor({ filtro: filter, q, page: String(page - 1) })} className="hover:text-white/70">
                ← anterior
              </Link>
            ) : (
              <span className="text-white/20">← anterior</span>
            )}
            <span>
              página {page} de {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={hrefFor({ filtro: filter, q, page: String(page + 1) })} className="hover:text-white/70">
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
