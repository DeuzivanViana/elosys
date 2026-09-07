import Link from "next/link";
import { notFound } from "next/navigation";
import { getPersonProfile, getPoliticianDonationNetwork } from "@/lib/queries";
import { ProvenanceTag } from "@/components/provenance-tag";
import { PoliticianNetwork } from "@/components/politician-network";
import { FinanceTable } from "@/components/finance-table";
import { formatBRL, formatCnpj, formatCpf, platformLabel, resultTone } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PoliticoPage({ params }: PageProps<"/politico/[id]">) {
  const { id } = await params;
  const personId = Number(id);
  if (!Number.isInteger(personId)) notFound();

  const profile = getPersonProfile(personId);
  if (!profile) notFound();

  const { person, candidacies, campaignOrgs, socialMedia, finance, signals, signalsCount } = profile;
  const latest = candidacies[0];
  const displayName = person.canonicalName ?? latest?.fullName ?? "(nome indisponível)";
  const network = getPoliticianDonationNetwork(personId);

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-14 sm:px-10">
      <Link href="/" className="mono-label mb-8 inline-flex items-center gap-2 hover:text-white/60">
        ← nova busca
      </Link>

      <header className="border-b border-white/[0.07] pb-8">
        <div className="mono-label">ficha consolidada · pessoa #{person.id}</div>
        <h1 className="mt-3 text-[34px] leading-tight font-light tracking-tight text-balance sm:text-[42px]">
          {displayName}
        </h1>
        {latest ? (
          <div className="mt-2 text-[14px] text-white/55">
            {latest.office ?? "cargo n/d"} · {latest.partyAbbr ?? "s/partido"}/{latest.state ?? "—"} ·{" "}
            {latest.year}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3 font-mono text-[11px] text-white/50">
          <span>
            <span className="text-white/30">CPF </span>
            {formatCpf(person.cpf)}
            {person.cpf && !person.cpfTrusted ? (
              <span className="ml-1.5 text-elo-amber">reconciliado</span>
            ) : null}
          </span>
          <span>
            <span className="text-white/30">título eleitoral </span>
            {person.voterId ?? "não disponível"}
          </span>
          <span>
            <span className="text-white/30">candidaturas </span>
            {candidacies.length}
          </span>
          {signalsCount > 0 ? (
            <a href="#sinais" className="flex items-center gap-1.5 text-elo-red hover:text-elo-red/80">
              <span className="size-1.5 flex-none rounded-full bg-elo-red" />
              {signalsCount} {signalsCount === 1 ? "sinal de alerta" : "sinais de alerta"}
            </a>
          ) : null}
        </div>
      </header>

      {network.donatedTo.length > 0 || network.receivedFrom.length > 0 ? (
        <Section title="rede de doação entre candidatos · distância 2">
          <p className="mb-6 max-w-xl text-[12px] leading-relaxed text-white/40">
            Só entre <strong className="text-white/60">candidatos conhecidos</strong> (não conta empresa
            nem doador pessoa física) — <span className="text-elo-green">quem doou pra ele</span> à
            esquerda, <span className="text-[#8a93ff]">pra quem ele doou</span> à direita, e mais uma
            camada de distância em cada direção.
          </p>
          <PoliticianNetwork network={network} centerLabel={displayName} />
        </Section>
      ) : null}

      {signals.length > 0 ? (
        <section id="sinais" className="border-b border-white/[0.07] py-10">
          <div className="mb-2 flex items-baseline gap-3">
            <div className="mono-label !text-elo-red">sinais de alerta</div>
            <span className="font-mono text-[9px] text-white/30">
              {signalsCount} {signalsCount === 1 ? "sinal" : "sinais"}
              {signalsCount > signals.length ? ` · mostrando os ${signals.length} maiores` : ""}
            </span>
          </div>
          <p className="mb-6 max-w-xl text-[12px] leading-relaxed text-white/40">
            Gerados por regras sobre os dados já coletados — <strong className="text-white/55">não vêm de
            nenhuma fonte oficial e não são acusação</strong>. É indício, não prova: cada um pode ter
            explicação legítima (lote grande, item não detalhado, erro de digitação).
          </p>
          <div className="flex flex-col">
            {signals.map((s) => {
              const isHigh = s.severity === "high";
              const badgeColor = isHigh
                ? "border-elo-red/40 text-elo-red"
                : "border-elo-amber/40 text-elo-amber";
              return (
                <div key={s.id} className="border-b border-white/[0.06] py-4 last:border-0">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
                    <div className="flex items-center gap-2.5">
                      <span className={`flex-none rounded-sm border px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.08em] uppercase ${badgeColor}`}>
                        {s.severity}
                      </span>
                      <span className="font-mono text-[10px] text-white/35">
                        {s.role === "candidate" ? "como candidato" : s.role === "cycle_member" ? "no ciclo" : "como fornecedor"} ·{" "}
                        {s.rule} v{s.ruleVersion}
                      </span>
                      {s.aiReview ? (
                        <span
                          className={`flex-none rounded-sm border px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.08em] uppercase ${
                            s.aiReview.verdict === "bizarro"
                              ? "border-elo-red/40 text-elo-red"
                              : s.aiReview.verdict === "inconclusivo"
                                ? "border-elo-amber/40 text-elo-amber"
                                : "border-white/20 text-white/45"
                          }`}
                        >
                          IA: {s.aiReview.verdict === "plausivel" ? "plausível" : s.aiReview.verdict}
                        </span>
                      ) : null}
                    </div>
                    {s.expense ? (
                      <span className="flex-none font-mono text-[13px] text-white/80">
                        {formatBRL(s.expense.amountCents)}
                      </span>
                    ) : null}
                    {s.graphIds && s.graphIds.length > 0 ? (
                      <Link
                        href={`/grafo?add=${encodeURIComponent(s.graphIds.join(","))}`}
                        className="mono-label !text-white/45 hover:!text-elo-amber"
                      >
                        ver no grafo →
                      </Link>
                    ) : null}
                  </div>
                  <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/65">
                    {s.explanation}
                  </p>
                  {s.aiReview ? (
                    <p className="mt-2 max-w-2xl border-l-2 border-white/10 pl-3 text-[12px] leading-relaxed text-white/45">
                      <span className="mono-label !text-white/30">IA · {s.aiReview.model}</span>{" "}
                      {s.aiReview.explanation}
                    </p>
                  ) : null}
                  {s.expense ? (
                    <div className="mt-2 font-mono text-[10.5px] text-white/35">
                      {s.expense.year} · fornecedor: {s.expense.supplierName ?? "n/d"}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <Section title="candidaturas por eleição">
        <div className="flex flex-col">
          {candidacies.map((c) => {
            const tone = resultTone(c.result);
            const toneColor =
              tone === "green" ? "text-elo-green" : tone === "red" ? "text-elo-red" : "text-white/45";
            return (
              <div key={c.id} className="border-b border-white/[0.06] py-5 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[13px] text-white/70">{c.year}</span>
                    <span className="text-[15px]">{c.office ?? "cargo não informado"}</span>
                  </div>
                  <span className={`font-mono text-[11px] ${toneColor}`}>{c.result ?? "sem resultado"}</span>
                </div>
                <div className="mt-1.5 font-mono text-[11px] text-white/40">
                  {c.partyAbbr ?? "s/partido"}
                  {c.partyName ? ` · ${c.partyName}` : ""} · {c.state ?? "—"}
                  {c.municipality ? ` · ${c.municipality}` : ""}
                  {c.round ? ` · ${c.round}º turno` : ""}
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[10.5px] text-white/35 sm:grid-cols-3">
                  {c.ballotName ? <span>urna: {c.ballotName}</span> : null}
                  {c.candidacyStatus ? <span>situação: {c.candidacyStatus}</span> : null}
                  {c.occupation ? <span>ocupação: {c.occupation}</span> : null}
                  {c.education ? <span>escolaridade: {c.education}</span> : null}
                  {c.gender ? <span>gênero: {c.gender}</span> : null}
                  {c.race ? <span>raça/cor: {c.race}</span> : null}
                </div>
                <ProvenanceTag provenance={c.provenance} />
              </div>
            );
          })}
        </div>
      </Section>

      {campaignOrgs.length > 0 ? (
        <Section title="CNPJ de campanha">
          <p className="mb-4 max-w-xl text-[12px] text-white/40">
            Cada candidatura abre um CNPJ próprio para a campanha (Receita, natureza jurídica
            409-4). Vem da prestação de contas eleitorais do TSE, não do registro de candidatura.
          </p>
          <div className="flex flex-col">
            {campaignOrgs.map((o) => (
              <div key={o.id} className="border-b border-white/[0.06] py-4 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <Link
                    href={`/cnpj/${o.cnpj}`}
                    className="font-mono text-[13px] text-white/80 hover:text-elo-amber hover:underline"
                  >
                    {formatCnpj(o.cnpj)}
                  </Link>
                  <span className="font-mono text-[11px] text-white/40">{o.year}</span>
                </div>
                <div className="mt-1 font-mono text-[10.5px] text-white/35">
                  {o.office ?? "cargo n/d"} · {o.partyAbbr ?? "s/partido"}/{o.state ?? "—"}
                </div>
                <ProvenanceTag provenance={o.provenance} />
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {finance.donationsCount > 0 || finance.expensesCount > 0 ? (
        <Section title="finanças de campanha">
          <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <Kpi label="recebido em doações" value={formatBRL(finance.donationsTotalCents)}
                 sub={`${finance.donationsCount.toLocaleString("pt-BR")} doações`} />
            <Kpi label="despesas contratadas" value={formatBRL(finance.expensesTotalCents)}
                 sub={`${finance.expensesCount.toLocaleString("pt-BR")} despesas`} />
            <Kpi label="pago até agora" value={formatBRL(finance.paymentsTotalCents)}
                 sub="regime de caixa (despesas_pagas)" />
          </div>
        </Section>
      ) : null}

      {finance.donationsCount > 0 ? (
        <FinanceTable
          title="doações recebidas"
          scope="candidate"
          id={String(person.id)}
          dir="received"
          counterpartyLabel="doador"
          tone="green"
        />
      ) : null}

      {finance.expensesCount > 0 ? (
        <FinanceTable
          title="despesas — pra onde foi o dinheiro"
          scope="candidate"
          id={String(person.id)}
          dir="spent"
          counterpartyLabel="fornecedor"
          tone="amber"
        />
      ) : null}

      {socialMedia.length > 0 ? (
        <Section title="redes sociais declaradas">
          <p className="mb-4 max-w-xl text-[12px] text-white/40">
            URL informada pelo próprio candidato no registro de candidatura (obrigatório desde a
            Res. TSE 23.610/2019). Não é uma varredura do perfil — só a URL declarada.
          </p>
          <div className="flex flex-col">
            {socialMedia.map((s) => (
              <div key={s.id} className="border-b border-white/[0.06] py-4 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-sm border border-white/12 px-2 py-1 font-mono text-[9px] tracking-[0.1em] text-white/55 uppercase">
                      {platformLabel(s.platform)}
                    </span>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-elo-amber hover:text-elo-amber-bright max-w-md truncate text-[13px] hover:underline"
                    >
                      {s.url}
                    </a>
                  </div>
                  <span className="font-mono text-[11px] text-white/35">{s.year}</span>
                </div>
                <ProvenanceTag provenance={s.provenance} />
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/[0.07] py-10 last:border-0">
      <div className="mono-label mb-5">{title}</div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="mono-label !text-[8.5px]">{label}</div>
      <div className="mt-2 text-[22px] leading-none font-light tracking-tight">{value}</div>
      <div className="mt-1.5 font-mono text-[9.5px] text-white/32">{sub}</div>
    </div>
  );
}

