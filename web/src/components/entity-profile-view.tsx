import Link from "next/link";
import type { EntityProfile } from "@/lib/queries";
import { ProvenanceTag } from "@/components/provenance-tag";
import { FinanceTable } from "@/components/finance-table";
import { formatBRL, formatCnpj, formatCpf } from "@/lib/format";

export function EntityProfileView({ profile }: { profile: EntityProfile }) {
  const {
    cpfCnpj, isCompany, displayName, personId, companyKind, registry, partners,
    donationsGivenTotal, paymentsReceivedTotal, sanctions,
  } = profile;

  const formattedId = isCompany ? formatCnpj(cpfCnpj) : formatCpf(cpfCnpj);
  const kindLabel: Record<string, string> = {
    campaign: "CNPJ de campanha",
    donor: "já apareceu como doador",
    supplier: "já apareceu como fornecedor",
    sanctioned: "empresa sancionada",
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-14 sm:px-10">
      <Link href="/" className="mono-label mb-8 inline-flex items-center gap-2 hover:text-white/60">
        ← nova busca
      </Link>

      <header className="border-b border-white/[0.07] pb-8">
        <div className="mono-label">{isCompany ? "ficha de CNPJ" : "ficha de CPF"}</div>
        <h1 className="mt-3 font-mono text-[28px] leading-tight font-light tracking-tight sm:text-[34px]">
          {formattedId}
        </h1>
        {displayName ? (
          <div className="mt-2 text-[15px] text-white/60">{displayName}</div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {companyKind ? (
            <span className="rounded-sm border border-white/12 px-2 py-1 font-mono text-[9.5px] tracking-[0.08em] text-white/50 uppercase">
              {kindLabel[companyKind] ?? companyKind}
            </span>
          ) : null}
          {sanctions.length > 0 ? (
            <span className="rounded-sm border border-elo-red/40 px-2 py-1 font-mono text-[9.5px] tracking-[0.08em] text-elo-red uppercase">
              {sanctions.length} {sanctions.length === 1 ? "sanção federal" : "sanções federais"}
            </span>
          ) : null}
          {registry?.registryStatus ? (
            <span
              className={`rounded-sm border px-2 py-1 font-mono text-[9.5px] tracking-[0.08em] uppercase ${
                registry.registryStatus === "ATIVA"
                  ? "border-elo-green/40 text-elo-green"
                  : "border-white/12 text-white/50"
              }`}
            >
              {registry.registryStatus}
            </span>
          ) : null}
          {personId != null ? (
            <Link
              href={`/politico/${personId}`}
              className="rounded-sm border border-elo-amber/40 px-2 py-1 font-mono text-[9.5px] tracking-[0.08em] text-elo-amber uppercase hover:bg-elo-amber/10"
            >
              ver ficha de candidato →
            </Link>
          ) : null}
        </div>
      </header>

      {registry ? (
        <section className="border-b border-white/[0.07] py-10">
          <div className="mono-label mb-5">cadastro na Receita Federal</div>
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
          <ProvenanceTag provenance={registry.provenance} />

          {partners.length > 0 ? (
            <div className="mt-8">
              <div className="mono-label mb-4">quadro societário</div>
              <p className="mb-4 max-w-xl text-[11.5px] leading-relaxed text-white/40">
                CPF do sócio vem mascarado pela própria fonte — não é possível cruzar com
                candidatos de forma automática, só conferir o nome manualmente.
              </p>
              <div className="flex flex-col">
                {partners.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/[0.06] py-3 last:border-0"
                  >
                    <span className="text-[13px]">{p.partnerName}</span>
                    <span className="font-mono text-[10.5px] text-white/35">
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
        <section className="border-b border-white/[0.07] py-10">
          <div className="mono-label mb-2 !text-elo-red">sanções federais</div>
          <p className="mb-6 max-w-xl text-[12px] leading-relaxed text-white/40">
            CEIS/CNEP (Portal da Transparência, CGU) — impedimento de contratar com o governo
            e/ou multa por corrupção (Lei 8.429/1992, Lei 12.846/2013).
          </p>
          <div className="flex flex-col">
            {sanctions.map((s) => (
              <div key={s.id} className="border-b border-white/[0.06] py-4 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-sm border border-elo-red/40 px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.08em] text-elo-red uppercase">
                      {s.registry}
                    </span>
                    <span className="text-[13px] text-white/70">{s.category ?? "categoria n/d"}</span>
                  </div>
                  {s.fineAmountCents ? (
                    <span className="flex-none font-mono text-[13px] text-elo-red">
                      {formatBRL(s.fineAmountCents)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 font-mono text-[10.5px] text-white/35">
                  {s.sanctioningAgency ?? "órgão n/d"} · {s.agencySphere ?? "—"}
                  {s.startDate ? ` · desde ${s.startDate}` : ""}
                  {s.endDate ? ` até ${s.endDate}` : ""}
                </div>
                <ProvenanceTag provenance={s.provenance} />
              </div>
            ))}
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
        />
      ) : null}
    </main>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mono-label !text-[8.5px]">{label}</div>
      <div className="mt-1.5 text-[13px] text-white/75">{value}</div>
    </div>
  );
}
