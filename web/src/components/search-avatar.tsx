"use client";

import { useState } from "react";

/** Small round avatar for a search result row — tries the candidate's
 * official photo URL (elosys/tse/photo_urls.py, a direct TSE CDN link),
 * falls back to their name's first letter on a 404 (most candidates don't
 * have one on file, or an undocumented URL that broke) or when there's no
 * URL at all (a "pessoa física" result is never a candidate, so never has
 * a photo). Same photo source as the profile header and graph nodes, just
 * smaller. */
export function SearchAvatar({ photoUrl, name }: { photoUrl: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  if (photoUrl == null || failed) {
    return (
      <span className="search-avatar search-avatar--fallback" aria-hidden>
        {initial}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external TSE CDN, not a Next-optimizable local asset
    <img src={photoUrl} alt="" className="search-avatar" onError={() => setFailed(true)} />
  );
}
