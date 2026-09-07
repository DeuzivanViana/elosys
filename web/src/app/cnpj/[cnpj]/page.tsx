import { notFound, redirect } from "next/navigation";
import { candidatePersonId, getEntityProfile } from "@/lib/queries";
import { EntityProfileView } from "@/components/entity-profile-view";
import { digitsOnly } from "@/lib/normalize";

export const dynamic = "force-dynamic";

export default async function CnpjPage({ params }: PageProps<"/cnpj/[cnpj]">) {
  const { cnpj } = await params;
  const digits = digitsOnly(cnpj);
  if (digits.length !== 14) notFound();

  // A campaign CNPJ IS its candidate -- send it to the full profile ("juntar os 3").
  const personId = candidatePersonId(digits);
  if (personId !== null) redirect(`/politico/${personId}`);

  const profile = getEntityProfile(digits);
  if (!profile) notFound();

  return <EntityProfileView profile={profile} />;
}
