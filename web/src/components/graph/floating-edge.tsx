"use client";

import { BaseEdge, EdgeLabelRenderer, getStraightPath, useInternalNode, type EdgeProps } from "@xyflow/react";
import { formatBRL } from "@/lib/format";
import type { GraphEdgeData } from "./types";

/**
 * A "floating" edge: source/target handles anchor at the node's actual
 * bounding circle, computed from the current node positions, so the line
 * always points straight at the other node's edge — not at a fixed handle
 * — regardless of where the force layout (or a manual drag) puts them.
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

  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });

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
            className="rounded-sm border border-white/15 bg-[#0d0d10] px-1.5 py-0.5 font-mono text-[8.5px] whitespace-nowrap text-white/70"
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
