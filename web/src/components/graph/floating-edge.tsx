"use client";

import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps } from "@xyflow/react";
import { formatBRL } from "@/lib/format";
import type { GraphEdgeData } from "./types";

// How far a curve bows away from the straight line between two nodes, as a
// fraction of their distance (clamped so it's neither invisible up close
// nor absurd far away).
const BEND_RATIO = 0.16;
const BEND_MIN = 14;
const BEND_MAX = 44;

/**
 * A "floating" edge: source/target handles anchor at the node's actual
 * bounding circle, computed from the current node positions, so the line
 * always points straight at the other node's edge — not at a fixed handle
 * — regardless of where the force layout (or a manual drag) puts them.
 *
 * Always drawn as a slight curve, never a straight line, bowing to a fixed
 * side *of the direction of travel* (always "clockwise" from source to
 * target). That's the whole trick: when money flows both ways between the
 * same two entities (a donation back AND a payment forward, or a 2-node
 * circular_donation cycle), the reverse edge travels in the opposite
 * direction, so its perpendicular flips automatically — the two edges bow
 * to opposite absolute sides without needing to special-case "is this the
 * reverse edge of some other edge". Don't also sign this off the node ids:
 * that would flip a *second* time for the reverse edge and cancel back out
 * to the same side, undoing the whole point.
 */
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
  const targetX = tc.x - ux * (tr + 10); // extra gap so the arrowhead doesn't sit under the circle
  const targetY = tc.y - uy * (tr + 10);

  const bend = Math.min(Math.max(dist * BEND_RATIO, BEND_MIN), BEND_MAX);
  const perpX = -uy;
  const perpY = ux;
  const midX = (sourceX + targetX) / 2 + perpX * bend;
  const midY = (sourceY + targetY) / 2 + perpY * bend;

  const path = `M${sourceX},${sourceY} Q${midX},${midY} ${targetX},${targetY}`;
  // Point on the quadratic curve at t=0.5 — where the amount label sits.
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

// The node box is a circle (of `radius`) stacked above its text label -- the
// circle's own center is NOT the box's center (the label below throws that
// off), so anchor on (boxWidth/2, radius) instead of (boxWidth/2, boxHeight/2).
function centerOf(node: ReturnType<typeof useInternalNode>, radius: number): { x: number; y: number } {
  const width = node!.measured?.width ?? radius * 2;
  return {
    x: node!.internals.positionAbsolute.x + width / 2,
    y: node!.internals.positionAbsolute.y + radius,
  };
}
