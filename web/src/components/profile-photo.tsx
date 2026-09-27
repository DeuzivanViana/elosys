"use client";

import { useState } from "react";

/** A candidate's official photo for a profile header — a direct TSE CDN
 * link (divulgacandcontas.tse.jus.br, see schema.sql's note on
 * candidate_photo), so it can 404 or break without warning; this just
 * hides itself on error instead of showing a broken-image icon. */
export function ProfilePhoto({ url, size }: { url: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external TSE CDN, not a Next-optimizable local asset
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="flex-none rounded-full border border-[var(--border-1)] object-cover"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
