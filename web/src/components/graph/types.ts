import type { GraphEdgeKind, GraphNodeKind } from "@/lib/queries";

export type GraphEdgeData = {
  amountCents: number;
  kind: GraphEdgeKind;
  circular: boolean;
  showLabel: boolean;
};

export type GraphNodeData = {
  cpfCnpj: string;
  type: "person" | "company";
  kind: GraphNodeKind;
  label: string;
  sanctioned: boolean;
  registryStatus: string | null;
  radius: number;
  loading: boolean;
};

export const NODE_COLOR: Record<GraphNodeKind, { fill: string; stroke: string; text: string }> = {
  politician: { fill: "#2a2013", stroke: "#e0a83f", text: "#f2c86a" },
  donor: { fill: "#132420", stroke: "#4fb286", text: "#7fd4ac" },
  supplier: { fill: "#151c2e", stroke: "#7896ff", text: "#a9baff" },
  sanctioned: { fill: "#2a1613", stroke: "#e0563f", text: "#f28a72" },
  company: { fill: "#161618", stroke: "rgba(255,255,255,.35)", text: "rgba(255,255,255,.7)" },
  // A pessoa física que aparece só como doadora/fornecedora mas sem nenhum
  // vínculo de doação/pagamento visível ainda (raro -- ex: adicionada direto
  // pela busca) -- neutro, igual ao "empresa" sem classificação, NUNCA âmbar.
  person: { fill: "#18181a", stroke: "rgba(255,255,255,.3)", text: "rgba(255,255,255,.65)" },
};

export const NODE_KIND_LABEL: Record<GraphNodeKind, string> = {
  politician: "político",
  donor: "doador",
  supplier: "fornecedor",
  sanctioned: "sancionado",
  company: "empresa",
  person: "pessoa física",
};
