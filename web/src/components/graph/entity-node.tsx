"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_COLOR, NODE_KIND_LABEL, type GraphNodeData } from "./types";

/**
 * Circle + label, stacked. Politicians are always the amber "politician"
 * color and drawn bigger — visually unmistakable from any company node,
 * whatever its own color (doador verde, fornecedor azul, sancionado
 * vermelho). Click expands the node's network (handled by the parent via
 * onNodeClick); this component only renders.
 */
export function EntityNode({ data, selected }: NodeProps & { data: GraphNodeData }) {
  const color = NODE_COLOR[data.kind];
  const d = data.radius * 2;

  return (
    <div className="flex w-[132px] flex-col items-center gap-1.5" title={data.label}>
      {/* invisible handles at every side so floating edges can attach from any direction */}
      <Handle type="source" position={Position.Top} id="s" style={handleStyle} />
      <Handle type="target" position={Position.Top} id="t" style={handleStyle} />

      <div
        className="relative flex items-center justify-center rounded-full transition-shadow"
        style={{
          width: d,
          height: d,
          background: color.fill,
          border: `${selected ? 3 : data.kind === "politician" ? 2.5 : 1.6}px solid ${color.stroke}`,
          boxShadow: selected
            ? `0 0 0 3px ${color.stroke}33, 0 4px 18px rgba(0,0,0,.5)`
            : "0 2px 10px rgba(0,0,0,.4)",
        }}
      >
        {data.loading ? (
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-white/50" />
        ) : data.sanctioned ? (
          <span className="text-[13px]">⚠</span>
        ) : data.kind === "politician" ? (
          <span className="text-[13px]">★</span>
        ) : null}
      </div>

      <div
        className="max-w-[132px] truncate rounded-sm px-1.5 py-0.5 text-center font-mono text-[9.5px]"
        style={{ color: color.text, background: "rgba(8,8,10,.55)" }}
      >
        {data.label}
      </div>
      <div className="font-mono text-[7.5px] tracking-[0.1em] text-white/25 uppercase">
        {NODE_KIND_LABEL[data.kind]}
      </div>
    </div>
  );
}

const handleStyle = { opacity: 0, pointerEvents: "none" as const };
