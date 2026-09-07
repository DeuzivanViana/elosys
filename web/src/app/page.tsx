import Link from "next/link";
import { SearchBox } from "@/components/search-box";
import { TopSuppliers } from "@/components/top-suppliers";
import { getHomeStats } from "@/lib/stats";
import { getExpenseYears } from "@/lib/queries";
import { formatBRL } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function Home() {
  const stats = getHomeStats();
  const expenseYears = getExpenseYears();

  const heroStats = [
    { label: "pessoas", value: stats.people.toLocaleString("pt-BR") },
    { label: "candidaturas", value: stats.candidacies.toLocaleString("pt-BR") },
    { label: "doações recebidas", value: formatBRL(stats.donationsTotalCents) },
    { label: "despesas contratadas", value: formatBRL(stats.expensesTotalCents) },
    { label: "período coberto", value: stats.years },
  ];

  return (
    <main className="flex min-h-screen flex-col">
      <div className="relative overflow-hidden border-b border-white/[0.07] px-6 py-20 sm:px-14 sm:py-28">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage: "radial-gradient(900px 420px at 22% 30%, #000, transparent 72%)",
          }}
        />
        <div className="relative mx-auto max-w-3xl">
          <div className="mb-7 flex items-center gap-3">
            <span className="h-px w-8 bg-white/30" />
            <span className="mono-label">busca de dados públicos · CPF/CNPJ</span>
          </div>
          <h1 className="text-[clamp(34px,6vw,60px)] leading-[1.04] font-light tracking-tight text-balance">
            Ficha pública de <span className="text-white/45">qualquer candidato</span> brasileiro
            <span className="text-elo-amber">.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-white/55">
            Busque por nome ou CPF. Cada campo mostra de qual arquivo do TSE ele saiu, quando foi
            baixado e o hash que comprova que não foi alterado.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <SearchBox />
            <Link
              href="/grafo"
              className="mono-label flex items-center gap-2 rounded-sm border border-white/12 px-4 py-3.5 !text-white/55 hover:border-white/30 hover:!text-white/85"
            >
              ⌗ grafo de correlações
            </Link>
            <Link
              href="/sinais/doacao-circular"
              className="mono-label flex items-center gap-2 rounded-sm border border-white/12 px-4 py-3.5 !text-white/55 hover:border-white/30 hover:!text-white/85"
            >
              ⟲ doação circular
            </Link>
            <Link
              href="/sinais/analise-ia"
              className="mono-label flex items-center gap-2 rounded-sm border border-white/12 px-4 py-3.5 !text-white/55 hover:border-white/30 hover:!text-white/85"
            >
              ✦ análise de IA
            </Link>
            <Link
              href="/sinais/socio-fornecedor"
              className="mono-label flex items-center gap-2 rounded-sm border border-white/12 px-4 py-3.5 !text-white/55 hover:border-white/30 hover:!text-white/85"
            >
              ⌂ sócio de fornecedor
            </Link>
            <Link
              href="/sinais/discurso"
              className="mono-label flex items-center gap-2 rounded-sm border border-white/12 px-4 py-3.5 !text-white/55 hover:border-white/30 hover:!text-white/85"
            >
              ✎ discurso em rede social
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 border-b border-white/[0.07] sm:grid-cols-5">
        {heroStats.map((s) => (
          <div key={s.label} className="border-r border-white/[0.07] px-6 py-6 last:border-r-0">
            <div className="mono-label">{s.label}</div>
            <div className="mt-3 text-[28px] font-light tracking-tight">{s.value}</div>
          </div>
        ))}
      </div>

      <TopSuppliers years={expenseYears} />

      <div className="mx-auto w-full max-w-3xl px-6 py-14 sm:px-14">
        <div className="mono-label mb-4">indício não é prova</div>
        <p className="max-w-2xl text-[13.5px] leading-relaxed text-white/50 text-pretty">
          O EloSys reúne dados que já são públicos por lei (registro de candidatura do TSE,
          prestação de contas eleitorais, redes sociais declaradas) e os organiza por pessoa. Nada
          aqui é acusação — é o dado bruto oficial, com a fonte exposta em cada campo, para que
          qualquer um confira e vá além se quiser apurar.
        </p>
      </div>
    </main>
  );
}
