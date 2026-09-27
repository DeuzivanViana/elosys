"use client";

import { useState } from "react";
import type { Provenance } from "@/lib/queries";
import { Modal } from "./ui/modal";
import { useShell } from "./shell/shell-context";

function formatDate(iso: string): string {
  try {
    return (
      new Date(iso).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC"
    );
  } catch {
    return iso;
  }
}

/**
 * Wraps a piece of UI that came from one specific downloaded file. Normally
 * a no-op passthrough (children render exactly as if this wrapper weren't
 * there) — the "fonte" toggle in the navbar (see shell-context's
 * `analysisMode`) is what turns it into an inspectable zone: hover to
 * highlight, click to open the provenance popup (source, URL, when it was
 * fetched, the sha256 `elosys verify` checks) instead of whatever the
 * wrapped content would normally do on click.
 *
 * Replaces the old always-visible "fonte" button (one per row) that used to
 * clutter every list — see ADs and the git history for `provenance-tag.tsx`.
 */
export function SourceZone({
  provenance, children, inline = false, as, className,
}: {
  /** null when the caller couldn't resolve a source for this particular
   * row (rare) -- the zone just renders its children plainly, same as if
   * analysis mode were off, instead of the caller having to branch. */
  provenance: Provenance | null;
  children: React.ReactNode;
  /** render as <span> instead of <div>, for inline contexts (e.g. inside a <td>). */
  inline?: boolean;
  /** render as a specific tag -- "tr" to wrap a table row (a <div>/<span>
   * can't be a <tbody> child). See globals.css's `tr.source-zone` overrides:
   * a <tr> gets the background/box-shadow highlight same as any other zone,
   * but NEVER `position`, `transform`, or the ::before laser ring -- table
   * row boxes render inconsistently across browsers once you touch those
   * (rows collapsing, cells misaligning), so this tag gets the plain,
   * static version of the highlight instead of the fancy one. */
  as?: "div" | "span" | "tr";
  className?: string;
}) {
  const { analysisMode } = useShell();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);

  // With no explicit tag, an off-mode zone skips the wrapper element
  // entirely (a plain Fragment) -- it was only ever a hover/click
  // convenience. An explicit `as` (e.g. "tr", required by the surrounding
  // HTML) always renders that real tag so the markup stays valid either way.
  if (!analysisMode || !provenance) {
    if (!as) return <>{children}</>;
    const PlainTag = as;
    return <PlainTag className={className}>{children}</PlainTag>;
  }

  const Tag = as ?? (inline ? "span" : "div");
  return (
    <>
      <Tag
        className={`source-zone${hover ? " source-zone--hover" : ""}${className ? ` ${className}` : ""}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClickCapture={(e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
      </Tag>
      {/* Rendered as a SIBLING, not a child, of the zone above: the popup
          (via <Modal>'s portal) is still a React descendant of this
          component either way, so if it were nested inside the <Tag> its
          own close button's click would bubble up through the same
          onClickCapture and get swallowed before ever reaching the button
          -- the popup would render but nothing inside it would be
          clickable. Keeping it here, outside the capturing element,
          avoids that entirely. */}
      {open ? <ProvenanceModal provenance={provenance} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function ProvenanceModal({ provenance, onClose }: { provenance: Provenance; onClose: () => void }) {
  return (
    <Modal title="proveniência" onClose={onClose}>
      <dl className="seal__body">
        <Row label="fonte" value={provenance.sourceName} />
        <Row label="órgão" value={provenance.agency} />
        <Row
          label="url"
          value={
            <a href={provenance.url} target="_blank" rel="noreferrer">
              {provenance.url}
            </a>
          }
        />
        <Row label="coletado em" value={formatDate(provenance.accessedAt)} />
        <Row label="sha256" value={provenance.sha256} />
        <Row label="parser" value={`${provenance.parserName} v${provenance.parserVersion}`} />
        {provenance.legalBasis ? <Row label="base legal" value={provenance.legalBasis} /> : null}
      </dl>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
