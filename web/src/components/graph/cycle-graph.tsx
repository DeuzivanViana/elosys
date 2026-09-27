"use client";

import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import type { AiReviewBrief, CycleNode } from "@/lib/queries";
import { formatBRL } from "@/lib/format";
import { useColorMode } from "@/lib/use-color-mode";
import { EntityNode } from "./entity-node";
import { FloatingEdge } from "./floating-edge";
import type { GraphEdgeData, GraphNodeData } from "./types";

const nodeTypes = { entity: EntityNode };
const edgeTypes = { floating: FloatingEdge };

const NODE_R = 22;
const RING_R = 92; // px from center to each node, grows with node count below

type FlowNode = Node<GraphNodeData, "entity">;
type FlowEdge = Edge<GraphEdgeData, "floating">;

/**
 * A ciclo (A -> B -> C -> A) IS the card, not a graph tucked under a text
 * header — the graph fills the whole thing, and the signal's facts (severity,
 * rule, IA verdict, valor) sit in a gradient scrim pinned over its top edge,
 * "ver grafo completo" pinned to the bottom-right corner. Always visible
 * (no show/hide toggle) — this is the signal, not an optional extra.
 */
export function CycleGraph({
  nodes: cycleNodes, selfCpfCnpj, edgeAmounts, severity, roleLabel, aiReview, amountCents, pathLength, graphHref,
}: {
  nodes: CycleNode[];
  selfCpfCnpj: string | null;
  edgeAmounts: number[];
  severity: "low" | "medium" | "high";
  roleLabel: string;
  aiReview: AiReviewBrief | null;
  amountCents: number | null;
  pathLength: number | null;
  graphHref: string | null;
}) {
  const isHigh = severity === "high";

  return (
    <div className="cycle-card">
      <ReactFlowProvider>
        <Ring nodes={cycleNodes} selfCpfCnpj={selfCpfCnpj} edgeAmounts={edgeAmounts} />
      </ReactFlowProvider>

      <div className="cycle-card__scrim">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {isHigh ? <span className="badge badge--red">{severity}</span> : null}
          <span className="mono" style={{ fontSize: 10, color: "var(--muted-2)" }}>
            {roleLabel} · circular_donations
            {pathLength ? ` · ${pathLength} nós` : ""}
          </span>
          {aiReview ? (
            <span
              className={`badge ${
                aiReview.verdict === "bizarro" ? "badge--red" : aiReview.verdict === "inconclusivo" ? "badge--accent" : ""
              }`}
            >
              IA: {aiReview.verdict === "plausivel" ? "plausível" : aiReview.verdict}
            </span>
          ) : null}
          {amountCents != null ? (
            <span className="num" style={{ fontSize: 13, marginLeft: "auto" }}>
              {formatBRL(amountCents)}
            </span>
          ) : null}
        </div>
        {aiReview ? (
          <p className="cycle-card__ai">
            <span className="mono-label">IA</span> {aiReview.explanation}
          </p>
        ) : null}
      </div>

      {graphHref ? (
        <Link href={graphHref} className="btn cycle-card__cta">
          grafo completo
        </Link>
      ) : null}
    </div>
  );
}

function Ring({
  nodes: cycleNodes, selfCpfCnpj, edgeAmounts,
}: { nodes: CycleNode[]; selfCpfCnpj: string | null; edgeAmounts: number[] }) {
  const router = useRouter();
  const colorMode = useColorMode();
  const n = cycleNodes.length;
  // n===2 is the tight, common case (the whole cycle is just "A <-> B") and
  // needs the most room: each node's own label sits right below its circle,
  // and with only 2 nodes the curves connecting them pass directly through
  // that space unless there's enough radius to bow clear of it.
  const radius = n === 2 ? 130 : n <= 3 ? 90 : n <= 5 ? RING_R : 92 + (n - 5) * 14;
  const size = radius * 2 + 120;

  const { nodes, edges } = useMemo(() => {
    const flowNodes: FlowNode[] = cycleNodes.map((c, i) => {
      // Start at the right (not the top): for n===2 this lands the two
      // nodes side by side instead of stacked vertically, so the curve
      // between them runs at circle-center height, clear of each node's
      // own label (which sits BELOW its circle, not beside it).
      const angle = (2 * Math.PI * i) / n;
      const isSelf = selfCpfCnpj != null && c.cpfCnpj === selfCpfCnpj;
      return {
        id: c.cpfCnpj,
        type: "entity",
        position: {
          x: size / 2 + radius * Math.cos(angle) - NODE_R,
          y: size / 2 + radius * Math.sin(angle) - NODE_R,
        },
        draggable: false,
        connectable: false,
        data: {
          cpfCnpj: c.cpfCnpj,
          type: c.type,
          // A cycle member with a `people` row really did run for office --
          // same "político" color/photo treatment as any other candidate
          // node, not the generic "pessoa física" gray.
          kind: isSelf ? "self" : c.type === "company" ? "company" : c.personId != null ? "politician" : "person",
          label: c.label,
          sanctioned: false,
          registryStatus: null,
          radius: NODE_R,
          loading: false,
          photoUrl: c.photoUrl,
        },
      };
    });

    const flowEdges: FlowEdge[] = cycleNodes.map((c, i) => {
      const next = cycleNodes[(i + 1) % n];
      const amountCents = edgeAmounts[i] ?? 0;
      return {
        id: `${c.cpfCnpj}->${next.cpfCnpj}->${i}`,
        source: c.cpfCnpj,
        target: next.cpfCnpj,
        type: "floating",
        data: { amountCents, kind: "donation", circular: true, showLabel: amountCents > 0 },
        style: { stroke: "var(--red)", strokeWidth: 2, strokeDasharray: "7 5", opacity: 0.9 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--red)", width: 13, height: 13 },
      };
    });

    return { nodes: flowNodes, edges: flowEdges };
  }, [cycleNodes, n, radius, size, selfCpfCnpj, edgeAmounts]);

  const onNodeClick: NodeMouseHandler<FlowNode> = (_e, node) => {
    const href = node.id.length === 14 ? `/cnpj/${node.id}` : `/cpf/${node.id}`;
    router.push(href);
  };

  return (
    <ReactFlow<FlowNode, FlowEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={onNodeClick}
      colorMode={colorMode}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.3}
      maxZoom={1.8}
      nodesDraggable={false}
      nodesConnectable={false}
      panOnDrag
      proOptions={{ hideAttribution: true }}
    />
  );
}
