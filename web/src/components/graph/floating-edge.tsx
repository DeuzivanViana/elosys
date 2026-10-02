"use client";

import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps } from "@xyflow/react";
import { formatBRL } from "@/lib/format";
import type { GraphEdgeData } from "./types";

const BEND_RATIO = 0.16;
const BEND_MIN = 14;
const BEND_MAX = 44;

// Curve always bows clockwise from source to target; flipping by node ids too would cancel it.
export function FloatingEdge(props: EdgeProps & { data?: GraphEdgeData }) {
  const { id, source, target, style, markerEnd, data } = props;
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;

  const sr = (sourceNode.data as { radius?: number }).radius ?? 24;
  const tr = (targetNode.data as { radius?: number }).radius ?? 24;
  const sc = centerOf(sourceNode, sr);
  const tc = centerOf(targetNode, tr);
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  const sourceX = sc.x + ux * (sr + 2);
  const sourceY = sc.y + uy * (sr + 2);
  const targetX = tc.x - ux * (tr + 10);
  const targetY = tc.y - uy * (tr + 10);

  const bend = Math.min(Math.max(dist * BEND_RATIO, BEND_MIN), BEND_MAX);
  const perpX = -uy;
  const perpY = ux;
  const midX = (sourceX + targetX) / 2 + perpX * bend;
  const midY = (sourceY + targetY) / 2 + perpY * bend;

  const path = `M${sourceX},${sourceY} Q${midX},${midY} ${targetX},${targetY}`;
  const labelX = 0.25 * sourceX + 0.5 * midX + 0.25 * targetX;
  const labelY = 0.25 * sourceY + 0.5 * midY + 0.25 * targetY;

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {data?.amountCents != null && data.showLabel ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
            className="rounded-sm border border-[var(--border-2)] bg-[var(--card-tone)] px-1.5 py-0.5 font-mono text-[8.5px] whitespace-nowrap text-[var(--fg-2)]"
          >
            {formatBRL(data.amountCents)}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

// Circle center is (boxWidth/2, radius), not the box center, because the label sits below.
function centerOf(node: ReturnType<typeof useInternalNode>, radius: number): { x: number; y: number } {
  const width = node!.measured?.width ?? radius * 2;
  return {
    x: node!.internals.positionAbsolute.x + width / 2,
    y: node!.internals.positionAbsolute.y + radius,
  };
}
