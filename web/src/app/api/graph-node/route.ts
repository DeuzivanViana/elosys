import { NextResponse } from "next/server";
import { resolveGraphNode } from "@/lib/queries";

/** Resolves ONE cpf/cnpj's own info -- no neighbors. Used when adding a node
 * to /grafo (see graph-canvas.tsx: adding never auto-expands a whole
 * donor/supplier network anymore; /api/graph-paths then finds the
 * distance-<=2 links to whatever else is already on the canvas). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { cpfCnpj?: unknown } | null;
  const cpfCnpj = typeof body?.cpfCnpj === "string" ? body.cpfCnpj : "";
  const node = resolveGraphNode(cpfCnpj);
  return NextResponse.json({ node });
}
