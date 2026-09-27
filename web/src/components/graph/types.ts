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
  // Part of a reciprocal/circular money flow (e.g. donated to AND received
  // from the same node) — drawn with a red ring regardless of `kind`.
  circular?: boolean;
  // Only set for candidates (`kind` "politician"/"self") that have a photo
  // on file (elosys/tse/photo_urls.py) — a direct TSE CDN URL, hotlinked by
  // EntityNode instead of a plain colored circle. Never set for
  // companies/donors, and null (not just absent) when there's no photo.
  photoUrl?: string | null;
};

export const NODE_COLOR: Record<GraphNodeKind, { fill: string; stroke: string; text: string }> = {
  // The candidate whose page this is — always gold, always unmistakable,
  // never confused with a generic "politician" node found elsewhere in a
  // network (those stay neutral gray — the app's accent, see globals.css).
  self: { fill: "rgba(234,179,8,.16)", stroke: "var(--gold)", text: "var(--gold)" },
  politician: { fill: "rgba(var(--accent-rgb),.16)", stroke: "var(--accent)", text: "var(--accent-2)" },
  donor: { fill: "rgba(34,197,94,.12)", stroke: "var(--green)", text: "var(--green)" },
  supplier: { fill: "rgba(var(--accent-2-rgb),.12)", stroke: "var(--accent-2)", text: "var(--accent-2)" },
  sanctioned: { fill: "rgba(239,68,68,.14)", stroke: "var(--red)", text: "var(--red)" },
  company: { fill: "var(--card-tone)", stroke: "var(--border-2)", text: "var(--fg-2)" },
  // A pessoa física que aparece só como doadora/fornecedora mas sem nenhum
  // vínculo de doação/pagamento visível ainda (raro -- ex: adicionada direto
  // pela busca) -- neutro, igual ao "empresa" sem classificação, NUNCA violeta.
  person: { fill: "var(--card-tone)", stroke: "var(--muted-2)", text: "var(--muted)" },
};

export const NODE_KIND_LABEL: Record<GraphNodeKind, string> = {
  self: "este candidato",
  politician: "político",
  donor: "doador",
  supplier: "fornecedor",
  sanctioned: "sancionado",
  company: "empresa",
  person: "pessoa física",
};
