"use client";

import { useState } from "react";

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
