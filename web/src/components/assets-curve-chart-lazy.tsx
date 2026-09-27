"use client";

import dynamic from "next/dynamic";

// recharts is only needed on this one section of one page -- code-split it
// into its own chunk and skip SSR (ResponsiveContainer needs a measured DOM
// width anyway, so server-rendering it would just be re-done on hydration).
// `next/dynamic` with `ssr: false` isn't allowed directly inside a Server
// Component, hence this tiny client-only wrapper.
export const AssetsCurveChart = dynamic(
  () => import("./assets-curve-chart").then((m) => m.AssetsCurveChart),
  { ssr: false, loading: () => <div className="skeleton" style={{ height: 200 }} /> }
);
