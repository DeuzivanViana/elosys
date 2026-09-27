import Link from "next/link";
import type { EntityProfile } from "@/lib/queries";
import { getCompanyEarmarks } from "@/lib/queries";
import { SourceZone } from "@/components/source-zone";
import { FinanceTable } from "@/components/finance-table";
import { PageHeader } from "@/components/shell/shell-context";
import { YearSelect } from "@/components/ui/year-select";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBRL, formatCnpj, formatCpf } from "@/lib/format";

export function EntityProfileView({
  profile, years, year,
}: {
  profile: EntityProfile;
  /** Election years that have any campaign finance data (see getExpenseYears). */
  years: number[];
  /** The year currently selected via `?ano=`, if any. */
  year?: number;
}) {
  const {
    cpfCnpj, isCompany, displayName, personId, companyKind, registry, partners,
    donationsGivenTotal, paymentsReceivedTotal, sanctions,
  } = profile;
  const basePath = isCompany ? `/cnpj/${cpfCnpj}` : `/cpf/${cpfCnpj}`;
  const companyEarmarks = isCompany ? getCompanyEarmarks(cpfCnpj) : null;

  const formattedId = isCompany ? formatCnpj(cpfCnpj) : formatCpf(cpfCnpj);
  const kindLabel: Record<string, string> = {
    campaign: "CNPJ de campanha",
    donor: "já apareceu como doador",
    supplier: "já apareceu como fornecedor",
    sanctioned: "empresa sancionada",
  };

  return (
    <main className="mx-auto w-full max-w-4xl">
      <PageHeader
        group={isCompany ? "Ficha de CNPJ" : "Ficha de CPF"}
        current={displayName ?? formattedId}
        actions={<YearSelect basePath={basePath} years={years} value={year} />}
      />

      <header className="border-b border-[var(--border-1)] pb-8">
        <div className="label">{isCompany ? "ficha de CNPJ" : "ficha de CPF"}</div>
        <h1 className="num mt-3 text-[28px] leading-tight font-medium tracking-tight sm:text-[34px]">
          {formattedId}
        </h1>
        {displayName ? (
          <div className="mt-2 text-[15px]" style={{ color: "var(--muted)" }}>{displayName}</div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {companyKind ? <span className="badge">{kindLabel[companyKind] ?? companyKind}</span> : null}
          {sanctions.length > 0 ? (
            <span className="badge badge--red">
              {sanctions.length} {sanctions.length === 1 ? "sanção federal" : "sanções federais"}
            </span>
          ) : null}
          {registry?.registryStatus ? (
            <span className={`badge ${registry.registryStatus === "ATIVA" ? "badge--green" : ""}`}>
              {registry.registryStatus}
            </span>
          ) : null}
          {personId != null ? (
            <Link href={`/politico/${personId}`} className="badge badge--accent">
              ver ficha de candidato →
            </Link>
          ) : null}
        </div>
      </header>

      {registry ? (
        <section className="border-b border-[var(--border-1)] py-10">
          <div className="mono-label mb-5">cadastro na Receita Federal</div>
          <SourceZone provenance={registry.provenance}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
              <InfoField label="aberta em" value={registry.openedAt ?? "não disponível"} />
              <InfoField label="natureza jurídica" value={registry.legalNature ?? "n/d"} />
              <InfoField
                label="capital social"
                value={registry.shareCapitalCents != null ? formatBRL(registry.shareCapitalCents) : "n/d"}
              />
              <InfoField label="porte" value={registry.size ?? "n/d"} />
              <InfoField label="atividade principal" value={registry.primaryCnae ?? "n/d"} />
              <InfoField
                label="localização"
                value={registry.city && registry.state ? `${registry.city}/${registry.state}` : "n/d"}
              />
            </div>
          </SourceZone>

          {partners.length > 0 ? (
            <div className="mt-8">
              <div className="mono-label mb-4">quadro societário</div>
              <p className="mb-4 max-w-xl text-[11.5px] leading-relaxed text-[var(--muted-2)]">
                CPF do sócio vem mascarado pela própria fonte — não é possível cruzar com
                candidatos de forma automática, só conferir o nome manualmente.
              </p>
              <div className="flex flex-col">
                {partners.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--border-1)] py-3 last:border-0"
                  >
                    <span className="text-[13px]">{p.partnerName}</span>
                    <span className="font-mono text-[10.5px] text-[var(--muted-2)]">
                      {p.role ?? "papel n/d"}
                      {p.entryDate ? ` · desde ${p.entryDate}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {sanctions.length > 0 ? (
        <section className="border-b border-[var(--border-1)] py-10">
          <div className="label mb-2" style={{ color: "var(--red)" }}>sanções federais</div>
          <p className="mb-6 max-w-xl text-[12px] leading-relaxed text-[var(--muted-2)]">
            CEIS/CNEP (Portal da Transparência, CGU) — impedimento de contratar com o governo
            e/ou multa por corrupção (Lei 8.429/1992, Lei 12.846/2013).
          </p>
          <div className="flex flex-col">
            {sanctions.map((s) => (
              <SourceZone key={s.id} provenance={s.provenance}>
                <div className="border-b border-[var(--border-1)] py-4 last:border-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div className="flex items-center gap-2.5">
                      <span className="badge badge--red">{s.registry}</span>
                      <span className="text-[13px]" style={{ color: "var(--fg-2)" }}>{s.category ?? "categoria n/d"}</span>
                    </div>
                    {s.fineAmountCents ? (
                      <span className="flex-none font-mono text-[13px] text-elo-red">
                        {formatBRL(s.fineAmountCents)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 font-mono text-[10.5px] text-[var(--muted-2)]">
                    {s.sanctioningAgency ?? "órgão n/d"} · {s.agencySphere ?? "—"}
                    {s.startDate ? ` · desde ${s.startDate}` : ""}
                    {s.endDate ? ` até ${s.endDate}` : ""}
                  </div>
                </div>
              </SourceZone>
            ))}
          </div>
        </section>
      ) : null}

      {companyEarmarks && companyEarmarks.earmarks.length > 0 ? (
        <section className="border-b border-[var(--border-1)] py-10">
          <div className="mono-label mb-2">Portal da Transparência · emendas parlamentares</div>
          <h2 className="mb-2 text-[15px] font-medium">
            emendas recebidas · {formatBRL(companyEarmarks.totalCents)} em {companyEarmarks.earmarks.length.toLocaleString("pt-BR")} emendas
          </h2>
          <p className="mb-6 max-w-xl text-[12px] leading-relaxed text-[var(--muted-2)]">
            Verbas do orçamento federal destinadas a esta empresa via emenda. O autor é
            identificado só por nome (a fonte não tem CPF do autor) — um cruzamento provável, não
            uma identidade confirmada.
          </p>
          <div className="table-wrap">
            <div className="overflow-x-auto">
              <table className="table min-w-[640px]">
                <thead>
                  <tr>
                    <th>autor da emenda</th>
                    <th>localidade</th>
                    <th className="text-right">valor recebido</th>
                  </tr>
                </thead>
                <tbody>
                  {companyEarmarks.earmarks.map((e) => (
                    <tr key={e.earmarkCode}>
                      <td>
                        {e.authorPersonId != null ? (
                          <Link href={`/politico/${e.authorPersonId}`} className="link-primary">
                            {e.authorName ?? "autor não identificado"}
                          </Link>
                        ) : (
                          e.authorName ?? "autor não identificado"
                        )}
                        {e.earmarkYear ? (
                          <div className="mono" style={{ fontSize: 9.5, color: "var(--muted-2)" }}>{e.earmarkYear}</div>
                        ) : null}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--muted)" }}>
                        {e.municipality && e.state ? `${e.municipality}/${e.state}` : e.state ?? "—"}
                      </td>
                      <td className="num">{formatBRL(e.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {donationsGivenTotal.count > 0 ? (
        <FinanceTable
          title={`pra quem já doou · ${formatBRL(donationsGivenTotal.totalCents)} em ${donationsGivenTotal.count.toLocaleString("pt-BR")} doações`}
          scope="entity"
          id={cpfCnpj}
          dir="given"
          counterpartyLabel="candidato"
          tone="green"
          year={year}
        />
      ) : null}

      {paymentsReceivedTotal.count > 0 ? (
        <FinanceTable
          title={`de quem já recebeu dinheiro · ${formatBRL(paymentsReceivedTotal.totalCents)} em ${paymentsReceivedTotal.count.toLocaleString("pt-BR")} pagamentos`}
          scope="entity"
          id={cpfCnpj}
          dir="received"
          counterpartyLabel="candidato"
          tone="neutral"
          year={year}
        />
      ) : null}

      {year && donationsGivenTotal.count === 0 && paymentsReceivedTotal.count === 0 ? (
        <div className="pt-4">
          <EmptyState icon="◌" title={`Nenhuma doação ou pagamento registrado em ${year}.`} compact />
        </div>
      ) : null}
    </main>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mono-label !text-[8.5px]">{label}</div>
      <div className="mt-1.5 text-[13px] text-[var(--fg-2)]">{value}</div>
    </div>
  );
}
