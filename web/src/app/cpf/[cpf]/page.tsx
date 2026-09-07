import { notFound, redirect } from "next/navigation";
import { candidatePersonId, getEntityProfile } from "@/lib/queries";
import { EntityProfileView } from "@/components/entity-profile-view";
import { digitsOnly } from "@/lib/normalize";

export const dynamic = "force-dynamic";

export default async function CpfPage({ params }: PageProps<"/cpf/[cpf]">) {
  const { cpf } = await params;
  const digits = digitsOnly(cpf);
  if (digits.length !== 11) notFound();

  // A candidate's CPF IS the candidate -- one profile per person ("juntar os 3").
  const personId = candidatePersonId(digits);
  if (personId !== null) redirect(`/politico/${personId}`);

  const profile = getEntityProfile(digits);
  if (!profile) notFound();

  return <EntityProfileView profile={profile} />;
}
