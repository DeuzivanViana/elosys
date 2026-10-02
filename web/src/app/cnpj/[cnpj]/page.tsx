import { notFound, redirect } from "next/navigation";
import { candidatePersonId, getEntityProfile, getExpenseYears } from "@/lib/queries";
import { EntityProfileView } from "@/components/entity-profile-view";
import { digitsOnly } from "@/lib/normalize";

export const dynamic = "force-dynamic";

export default async function CnpjPage({ params, searchParams }: PageProps<"/cnpj/[cnpj]">) {
  const { cnpj } = await params;
  const digits = digitsOnly(cnpj);
  if (digits.length !== 14) notFound();

  const personId = candidatePersonId(digits);
  if (personId !== null) redirect(`/politico/${personId}`);

  const sp = await searchParams;
  const anoParam = typeof sp.ano === "string" ? Number(sp.ano) : NaN;
  const years = getExpenseYears();
  const year = Number.isInteger(anoParam) && years.includes(anoParam) ? anoParam : undefined;

  const profile = getEntityProfile(digits, { year });
  if (!profile) notFound();

  return <EntityProfileView profile={profile} years={years} year={year} />;
}
