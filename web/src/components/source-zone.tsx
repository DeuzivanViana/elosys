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

export function SourceZone({
  provenance, children, inline = false, as, className,
}: {
  provenance: Provenance | null;
  children: React.ReactNode;
  inline?: boolean;
  /** "tr" wraps a table row; globals.css skips position/transform for it (breaks table layout). */
  as?: "div" | "span" | "tr";
  className?: string;
}) {
  const { analysisMode } = useShell();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);

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
      {/* Sibling, not child: nested, onClickCapture would swallow the modal's close click. */}
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
