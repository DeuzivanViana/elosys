"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import type { PoliticianDonationNetwork, PoliticianNetworkBranch, PoliticianNetworkNode } from "@/lib/queries";
import { useColorMode } from "@/lib/use-color-mode";
import { EntityNode } from "./graph/entity-node";
import { FloatingEdge } from "./graph/floating-edge";
import type { GraphEdgeData, GraphNodeData } from "./graph/types";

const nodeTypes = { entity: EntityNode };
const edgeTypes = { floating: FloatingEdge };

type NetNode = Node<GraphNodeData, "entity">;
type NetEdge = Edge<GraphEdgeData, "floating">;

const CENTER_R = 32;
const NODE_R = 22;
const NODE_BOX_H = 88;
const MIN_BAND = NODE_BOX_H + 6;
const CHILD_ROW = NODE_BOX_H;
const PAD_Y = 20;
const WIDTH = 1040;
const PAN_MARGIN = 140;

function toNode(n: PoliticianNetworkNode, x: number, y: number): NetNode {
  return {
    id: `p${n.personId}`,
    type: "entity",
    position: { x, y },
    draggable: false,
    connectable: false,
    data: {
      cpfCnpj: String(n.personId),
      type: "person",
      kind: "politician",
      label: n.label,
      sanctioned: false,
      registryStatus: null,
      radius: NODE_R,
      loading: false,
      photoUrl: n.photoUrl,
    },
  };
}

function toEdge(donorId: string, recipientId: string, amountCents: number, direction: "in" | "out", faint = false): NetEdge {
  const color = direction === "in" ? "var(--green)" : "var(--accent-2)";
  const w = Math.min(2.6, 0.6 + Math.log10(Math.max(1, amountCents) / 100) * 0.4);
  return {
    id: `${donorId}->${recipientId}`,
    source: donorId,
    target: recipientId,
    type: "floating",
    data: { amountCents, kind: "donation", circular: false, showLabel: !faint },
    style: { stroke: color, strokeWidth: faint ? Math.min(w, 1.4) : w, opacity: faint ? 0.45 : 0.75 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
  };
}

function layoutSide(
  branches: PoliticianNetworkBranch[], centerX: number, childX: number, totalHeight: number,
  side: "left" | "right",
): { nodes: NetNode[]; edges: NetEdge[] } {
  const bandHeights = branches.map((b) => Math.max(MIN_BAND, b.children.length * CHILD_ROW));
  const sideHeight = bandHeights.reduce((a, b) => a + b, 0);
  let cursor = (totalHeight - sideHeight) / 2;
  const nodes: NetNode[] = [];
  const edges: NetEdge[] = [];
  const direction = side === "left" ? "in" : "out";

  branches.forEach((b, i) => {
    const bandHeight = bandHeights[i];
    const parentY = cursor + bandHeight / 2;
    const parentId = `p${b.node.personId}`;
    nodes.push(toNode(b.node, centerX, parentY));
    edges.push(
      side === "left"
        ? toEdge(parentId, "center", b.node.amountCents, direction)
        : toEdge("center", parentId, b.node.amountCents, direction)
    );

    const childrenStart = cursor + (bandHeight - b.children.length * CHILD_ROW) / 2 + CHILD_ROW / 2;
    b.children.forEach((c, j) => {
      const childId = `p${c.personId}`;
      nodes.push(toNode(c, childX, childrenStart + j * CHILD_ROW));
      edges.push(
        side === "left"
          ? toEdge(childId, parentId, c.amountCents, direction, true)
          : toEdge(parentId, childId, c.amountCents, direction, true)
      );
    });
    cursor += bandHeight;
  });
  return { nodes, edges };
}

function Inner({
  network, centerLabel, centerPhotoUrl,
}: { network: PoliticianDonationNetwork; centerLabel: string; centerPhotoUrl: string | null }) {
  const router = useRouter();
  const { donatedTo, receivedFrom } = network;

  const { nodes, edges, height } = useMemo(() => {
    const leftHeight = receivedFrom.reduce((a, b) => a + Math.max(MIN_BAND, b.children.length * CHILD_ROW), 0);
    const rightHeight = donatedTo.reduce((a, b) => a + Math.max(MIN_BAND, b.children.length * CHILD_ROW), 0);
    const h = Math.max(leftHeight, rightHeight, MIN_BAND) + PAD_Y * 2;

    const xL2 = 20, xL1 = WIDTH * 0.28, xC = WIDTH / 2, xR1 = WIDTH * 0.72, xR2 = WIDTH - 140;
    const left = layoutSide(receivedFrom, xL1, xL2, h - PAD_Y * 2, "left");
    const right = layoutSide(donatedTo, xR1, xR2, h - PAD_Y * 2, "right");
    const bump = (arr: NetNode[]) => arr.map((n) => ({ ...n, position: { ...n.position, y: n.position.y + PAD_Y } }));

    const centerNode: NetNode = {
      id: "center",
      type: "entity",
      position: { x: xC, y: h / 2 },
      draggable: false,
      connectable: false,
      data: {
        cpfCnpj: "", type: "person", kind: "self", label: centerLabel,
        sanctioned: false, registryStatus: null, radius: CENTER_R, loading: false,
        photoUrl: centerPhotoUrl,
      },
    };

    const leftTopIds = new Set(receivedFrom.map((b) => `p${b.node.personId}`));
    const rightTopIds = new Set(donatedTo.map((b) => `p${b.node.personId}`));
    const circularIds = new Set([...leftTopIds].filter((id) => rightTopIds.has(id)));

    const bumpedLeft = bump(left.nodes);
    const bumpedRight = bump(right.nodes);

    // Dedupe by id, or React Flow renders duplicate keys. Keep the LEFT position.
    const seen = new Set<string>();
    const allNodes = [centerNode, ...bumpedLeft, ...bumpedRight]
      .filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      })
      .map((n) => (circularIds.has(n.id) ? { ...n, data: { ...n.data, circular: true } } : n));

    const seenEdge = new Set<string>();
    const allEdges = [...left.edges, ...right.edges]
      .filter((e) => {
        if (seenEdge.has(e.id)) return false;
        seenEdge.add(e.id);
        return true;
      })
      .map((e) => {
        const isCircularEdge = circularIds.has(e.source) || circularIds.has(e.target);
        if (!isCircularEdge) return e;
        return {
          ...e,
          style: { ...e.style, stroke: "var(--red)", strokeDasharray: "7 5", opacity: 0.95 },
          markerEnd: { type: MarkerType.ArrowClosed as const, color: "var(--red)", width: 14, height: 14 },
        };
      });

    return {
      nodes: allNodes,
      edges: allEdges,
      height: h,
    };
  }, [donatedTo, receivedFrom, centerLabel, centerPhotoUrl]);

  const onNodeClick: NodeMouseHandler<NetNode> = useCallback(
    (_e, node) => {
      if (node.id.startsWith("p")) router.push(`/politico/${node.id.slice(1)}`);
    },
    [router]
  );

  const colorMode = useColorMode();

  return (
    <div style={{ height: Math.min(560, height) }} className="w-full rounded-sm border border-[var(--border-1)]">
      <ReactFlow<NetNode, NetEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        colorMode={colorMode}
        fitView
        minZoom={0.4}
        maxZoom={1.6}
        translateExtent={[
          [-PAN_MARGIN, -PAN_MARGIN],
          [WIDTH + PAN_MARGIN, height + PAN_MARGIN],
        ]}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color={colorMode === "dark" ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.06)"} gap={26} size={1.2} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function PoliticianNetwork({
  network, centerLabel, centerPhotoUrl,
}: { network: PoliticianDonationNetwork; centerLabel: string; centerPhotoUrl: string | null }) {
  if (network.donatedTo.length === 0 && network.receivedFrom.length === 0) return null;
  return (
    <ReactFlowProvider>
      <Inner network={network} centerLabel={centerLabel} centerPhotoUrl={centerPhotoUrl} />
    </ReactFlowProvider>
  );
}
