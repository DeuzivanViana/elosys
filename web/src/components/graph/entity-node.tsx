"use client";

import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_COLOR, NODE_KIND_LABEL, type GraphNodeData } from "./types";

/**
 * Circle + label, stacked. The candidate whose page this is ("self") is
 * always gold and drawn bigger; other politicians stay violet — visually
 * unmistakable from any company node, whatever its own color (doador verde,
 * fornecedor violeta claro, sancionado vermelho). A node flagged `circular`
 * (money flowed both to and from it) gets a red ring regardless of kind —
 * that ring, not the fill color, is what says "doação circular aqui". Click
 * expands the node's network (handled by the parent via onNodeClick); this
 * component only renders.
 */
export function EntityNode({ data, selected }: NodeProps & { data: GraphNodeData }) {
  const color = NODE_COLOR[data.kind];
  const d = data.radius * 2;
  const big = data.kind === "politician" || data.kind === "self";
  const ringColor = data.circular ? "var(--red)" : color.stroke;
  // Photo only for the plain case -- a flagged node (loading/circular/
  // sanctioned) keeps its warning icon front and center rather than being
  // softened into a friendly headshot.
  const showPhoto = big && !data.loading && !data.circular && !data.sanctioned && data.photoUrl != null;

  return (
    <div className="flex w-[132px] flex-col items-center gap-1.5" title={data.label}>
      {/* invisible handles at every side so floating edges can attach from any direction */}
      <Handle type="source" position={Position.Top} id="s" style={handleStyle} />
      <Handle type="target" position={Position.Top} id="t" style={handleStyle} />

      <div
        className="relative flex items-center justify-center overflow-hidden rounded-full transition-shadow"
        style={{
          width: d,
          height: d,
          background: color.fill,
          border: `${selected ? 3 : data.circular ? 2.6 : big ? 2.5 : 1.6}px solid ${ringColor}`,
          boxShadow: data.circular
            ? "0 0 0 3px var(--red-tint), 0 4px 18px rgba(0,0,0,.5)"
            : selected
              ? `0 0 0 3px ${color.stroke}33, 0 4px 18px rgba(0,0,0,.5)`
              : "0 2px 10px rgba(0,0,0,.4)",
        }}
      >
        {showPhoto ? (
          <NodePhoto url={data.photoUrl!} />
        ) : data.loading ? (
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-white/50" />
        ) : data.circular ? (
          <span className="text-[13px]" style={{ color: "var(--red)" }}>↻</span>
        ) : data.sanctioned ? (
          <span className="text-[13px]">⚠</span>
        ) : data.kind === "self" ? (
          <span className="text-[13px]">★</span>
        ) : data.kind === "politician" ? (
          <span className="text-[13px]">★</span>
        ) : null}
      </div>

      <div
        className="max-w-[132px] truncate rounded-sm px-1.5 py-0.5 text-center font-mono text-[9.5px]"
        style={{ color: data.circular ? "var(--red)" : color.text, background: "rgba(8,8,10,.55)" }}
      >
        {data.label}
      </div>
      <div className="font-mono text-[7.5px] tracking-[0.1em] text-[var(--muted-2)] uppercase">
        {data.circular ? "doação circular" : NODE_KIND_LABEL[data.kind]}
      </div>
    </div>
  );
}

// The URL is a direct TSE CDN link (divulgacandcontas.tse.jus.br) -- an
// undocumented internal endpoint (see schema.sql's note on candidate_photo),
// so it can 404 or break without warning; falls back to the star then.
function NodePhoto({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="text-[13px]">★</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external TSE CDN, not a Next-optimizable local asset
    <img src={url} alt="" className="absolute inset-0 size-full object-cover" onError={() => setFailed(true)} />
  );
}

const handleStyle = { opacity: 0, pointerEvents: "none" as const };
