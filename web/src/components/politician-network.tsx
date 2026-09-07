"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import type { PoliticianDonationNetwork, PoliticianNetworkBranch, PoliticianNetworkNode } from "@/lib/queries";
import { EntityNode } from "./graph/entity-node";
import { FloatingEdge } from "./graph/floating-edge";
import { NODE_COLOR, type GraphEdgeData, type GraphNodeData } from "./graph/types";

// Same node/edge components, palette and floating-edge geometry as /grafo --
// this is the depth-2 politician-to-politician slice of that same graph.
const nodeTypes = { entity: EntityNode };
const edgeTypes = { floating: FloatingEdge };

type NetNode = Node<GraphNodeData, "entity">;
type NetEdge = Edge<GraphEdgeData, "floating">;

const CENTER_R = 30;
const NODE_R = 24;
const NODE_BOX_H = 96; // circle + label + kind label -> vertical room one node needs
const MIN_BAND = NODE_BOX_H + 8;
const CHILD_ROW = NODE_BOX_H; // vertical pitch between level-2 siblings
const PAD_Y = 24;
const WIDTH = 1040;
// Pan a little, never enough to drag the whole thing off-screen (unlike the
// free-roam /grafo). translateExtent + a tight zoom range.
const PAN_MARGIN = 160;

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
    },
  };
}

function toEdge(donorId: string, recipientId: string, amountCents: number, faint = false): NetEdge {
  const color = "#4fb286"; // donation green, same as /grafo
  const w = Math.min(2.6, 0.6 + Math.log10(Math.max(1, amountCents) / 100) * 0.4);
  return {
    id: `${donorId}->${recipientId}`,
    source: donorId,
    target: recipientId,
    type: "floating",
    data: { amountCents, kind: "donation", circular: false, showLabel: !faint },
    style: { stroke: color, strokeWidth: faint ? Math.min(w, 1.4) : w, opacity: faint ? 0.4 : 0.6 },
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

  branches.forEach((b, i) => {
    const bandHeight = bandHeights[i];
    const parentY = cursor + bandHeight / 2;
    const parentId = `p${b.node.personId}`;
    nodes.push(toNode(b.node, centerX, parentY));
    // money flows donor -> recipient: left = level-1 donated TO the center;
    // right = the center donated TO level-1.
    edges.push(
      side === "left"
        ? toEdge(parentId, "center", b.node.amountCents)
        : toEdge("center", parentId, b.node.amountCents)
    );

    const childrenStart = cursor + (bandHeight - b.children.length * CHILD_ROW) / 2 + CHILD_ROW / 2;
    b.children.forEach((c, j) => {
      const childId = `p${c.personId}`;
      nodes.push(toNode(c, childX, childrenStart + j * CHILD_ROW));
      edges.push(
        side === "left"
          ? toEdge(childId, parentId, c.amountCents, true)
          : toEdge(parentId, childId, c.amountCents, true)
      );
    });
    cursor += bandHeight;
  });
  return { nodes, edges };
}

function Inner({ network, centerLabel }: { network: PoliticianDonationNetwork; centerLabel: string }) {
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
        cpfCnpj: "", type: "person", kind: "politician", label: centerLabel,
        sanctioned: false, registryStatus: null, radius: CENTER_R, loading: false,
      },
    };

    return {
      nodes: [centerNode, ...bump(left.nodes), ...bump(right.nodes)],
      edges: [...left.edges, ...right.edges],
      height: h,
    };
  }, [donatedTo, receivedFrom, centerLabel]);

  const onNodeClick: NodeMouseHandler<NetNode> = useCallback(
    (_e, node) => {
      if (node.id.startsWith("p")) router.push(`/politico/${node.id.slice(1)}`);
    },
    [router]
  );

  return (
    <div style={{ height: Math.min(600, height) }} className="w-full rounded-sm border border-white/[0.07]">
      <ReactFlow<NetNode, NetEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        colorMode="dark"
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
        <Background color="rgba(255,255,255,.06)" gap={26} size={1.2} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(8,8,10,.75)"
          nodeColor={(n) => NODE_COLOR[(n as NetNode).data.kind].stroke}
        />
      </ReactFlow>
    </div>
  );
}

export function PoliticianNetwork({
  network, centerLabel,
}: { network: PoliticianDonationNetwork; centerLabel: string }) {
  if (network.donatedTo.length === 0 && network.receivedFrom.length === 0) return null;
  return (
    <ReactFlowProvider>
      <Inner network={network} centerLabel={centerLabel} />
    </ReactFlowProvider>
  );
}
