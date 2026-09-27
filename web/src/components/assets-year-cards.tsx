"use client";

import { useState } from "react";
import type { DeclaredAsset, DeclaredAssetsYearSummary } from "@/lib/queries";
import { formatBRL } from "@/lib/format";
import { Modal } from "./ui/modal";
import { SourceZone } from "./source-zone";

/** A card per election year with declared assets — click one to see that
 * year's individual items in a modal, instead of dumping every asset from
 * every year in one long flat list below the chart. */
export function AssetsYearCards({
  byYear, assets,
}: { byYear: DeclaredAssetsYearSummary[]; assets: DeclaredAsset[] }) {
  const [openYear, setOpenYear] = useState<number | null>(null);
  const yearAssets = assets.filter((a) => a.year === openYear);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {byYear.map((y) => (
          <button
            key={y.year}
            type="button"
            className="card"
            style={{ padding: "10px 14px", cursor: "pointer", textAlign: "left" }}
            onClick={() => setOpenYear(y.year)}
          >
            <div className="label">{y.year}</div>
            <div className="num mt-1" style={{ fontSize: 16 }}>{formatBRL(y.totalCents)}</div>
            <div className="mono mt-0.5" style={{ fontSize: 10, color: "var(--muted-2)" }}>
              {y.count.toLocaleString("pt-BR")} {y.count === 1 ? "bem" : "bens"}
            </div>
          </button>
        ))}
      </div>

      {openYear != null ? (
        <Modal title={`bens declarados em ${openYear}`} onClose={() => setOpenYear(null)}>
          <div className="flex flex-col gap-3">
            {yearAssets.map((a) => (
              <SourceZone key={a.id} provenance={a.provenance}>
                <div className="card" style={{ padding: "10px 12px" }}>
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0 flex-1">
                      {a.assetType ? (
                        <div className="text-[13px]" style={{ color: "var(--fg-2)" }}>{a.assetType}</div>
                      ) : null}
                      {a.description ? (
                        <div className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>{a.description}</div>
                      ) : null}
                    </div>
                    <span className="num flex-none" style={{ fontSize: 14 }}>{formatBRL(a.valueCents)}</span>
                  </div>
                  {a.sourceUpdatedAt ? (
                    <div className="mono mt-1.5" style={{ fontSize: 10, color: "var(--muted-2)" }}>
                      atualizado em {a.sourceUpdatedAt}
                    </div>
                  ) : null}
                </div>
              </SourceZone>
            ))}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
