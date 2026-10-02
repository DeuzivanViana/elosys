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
  circular?: boolean;
  photoUrl?: string | null;
};

export const NODE_COLOR: Record<GraphNodeKind, { fill: string; stroke: string; text: string }> = {
  self: { fill: "rgba(234,179,8,.16)", stroke: "var(--gold)", text: "var(--gold)" },
  politician: { fill: "rgba(var(--accent-rgb),.16)", stroke: "var(--accent)", text: "var(--accent-2)" },
  donor: { fill: "rgba(34,197,94,.12)", stroke: "var(--green)", text: "var(--green)" },
  supplier: { fill: "rgba(var(--accent-2-rgb),.12)", stroke: "var(--accent-2)", text: "var(--accent-2)" },
  sanctioned: { fill: "rgba(239,68,68,.14)", stroke: "var(--red)", text: "var(--red)" },
  company: { fill: "var(--card-tone)", stroke: "var(--border-2)", text: "var(--fg-2)" },
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
