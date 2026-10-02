import { NextResponse } from "next/server";
import { getGraphNodeNetwork } from "@/lib/queries";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { cpfCnpj?: unknown } | null;
  const cpfCnpj = typeof body?.cpfCnpj === "string" ? body.cpfCnpj : "";
  return NextResponse.json(getGraphNodeNetwork(cpfCnpj));
}
