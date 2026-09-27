import Link from "next/link";
import {
  getSupplierPartnerCount,
  getSupplierPartners,
  getSupplierPartnerSummary,
  type SupplierPartnerFilter,
} from "@/lib/queries";
import { formatBRL, formatCnpj } from "@/lib/format";
import { PageHeader } from "@/components/shell/shell-context";
import { PaginationLinks } from "@/components/ui/pagination-links";
import { EmptyState } from "@/components/ui/empty-state";

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
    <div className="flex flex-col gap-8">
      <PageHeader group="Sinais" current="Sócio de fornecedor" />

      <section>
        <div className="mono-label">
          elosys/rules/candidate_supplier_partner.py · cruzamento derivado
        </div>
        <h1 className="mt-3 text-[26px] leading-tight font-medium tracking-tight">
          Candidato sócio de uma empresa que recebeu dinheiro de campanha
        </h1>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          O candidato aparece no <strong style={{ color: "var(--fg-2)" }}>quadro societário</strong> (Receita, via
          BrasilAPI) de uma empresa que recebeu pagamento de alguma campanha.{" "}
          <strong style={{ color: "var(--fg-2)" }}>A correspondência NÃO é confirmada</strong> — a fonte
          mascara o CPF do sócio, então isso casa o nome normalizado com um candidato E os 6 dígitos
          visíveis do CPF. Pode ser coincidência (duas pessoas, mesmo nome, mesmos 6 dígitos). Casos
          ambíguos (2+ pessoas batendo) são descartados. Indício, não prova.
        </p>

        {summary.total === 0 ? null : (
          <div className="mono mt-6 flex flex-wrap items-center gap-x-6 gap-y-2" style={{ fontSize: 11, color: "var(--muted)" }}>
            <span>
              <span style={{ color: "var(--fg-1)" }}>{summary.total.toLocaleString("pt-BR")}</span> vínculos possíveis
            </span>
            <span>
              <span style={{ color: "var(--red)" }}>{summary.self.toLocaleString("pt-BR")}</span> pagaram a própria empresa
            </span>
            <span>
              <span style={{ color: "var(--accent-2)" }}>{summary.others.toLocaleString("pt-BR")}</span> pagas por outra campanha
            </span>
            <span>
              <span style={{ color: "var(--fg-1)" }}>{formatBRL(summary.totalCents)}</span> movimentados nessas empresas
            </span>
          </div>
        )}

        <form className="mt-5 flex flex-wrap items-center gap-2" action="/sinais/socio-fornecedor">
          {FILTERS.map((f) => (
            <Link key={f.value} href={hrefFor({ filtro: f.value, q })} className={`btn${filter === f.value ? " btn--primary" : ""}`}>
              {f.label}
            </Link>
          ))}
          <div className="input ml-2" style={{ width: 256 }}>
            <input name="q" defaultValue={q} placeholder="buscar candidato ou empresa…" />
          </div>
          {filter !== "all" ? <input type="hidden" name="filtro" value={filter} /> : null}
        </form>
      </section>

      <section>
        {summary.total === 0 ? (
          <EmptyState
            icon="◌"
            title="nenhum vínculo ainda"
            hint={
              <>
                <code>elosys candidate-supplier-partner --db elosys.db</code> (precisa de quadro
                societário já coletado via <code>receita-cnpj</code>)
              </>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState icon="◌" title="nada para esse filtro." />
        ) : (
          <div className="table-wrap">
            <div className="overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th>candidato (sócio)</th>
                  <th>empresa</th>
                  <th>papel · desde</th>
                  <th className="text-right">recebeu de campanhas</th>
                  <th className="text-right">quem pagou</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.personId}-${r.companyCnpj}`}>
                    <td>
                      <Link href={`/politico/${r.personId}`} className="hover:underline">
                        {r.personName ?? "candidato"}
                      </Link>
                      <div className="mono-label" style={{ fontSize: 8, color: "var(--muted-2)" }}>
                        correspondência não confirmada
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
                    <td style={{ color: "var(--muted)" }}>
                      {r.partnerRole ?? "—"}
                      {r.partnerSince ? <span style={{ color: "var(--muted-2)" }}> · {r.partnerSince}</span> : null}
                    </td>
                    <td className="num" style={{ color: "var(--accent-2)" }}>
                      {formatBRL(r.paymentsTotalCents)}
                      <div style={{ fontSize: 9.5, color: "var(--muted-2)" }}>
                        {r.paymentsCount.toLocaleString("pt-BR")} pagamentos
                      </div>
                    </td>
                    <td className="num">
                      {r.paidBySelf ? (
                        <span style={{ color: "var(--red)" }}>a própria campanha</span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>{r.payerCandidacies} campanha(s)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {totalPages > 1 ? (
              <div className="table-footer">
                <PaginationLinks
                  page={page}
                  totalPages={totalPages}
                  makeHref={(p) => hrefFor({ filtro: filter, q, page: String(p) })}
                />
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
