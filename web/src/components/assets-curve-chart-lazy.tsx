"use client";

import dynamic from "next/dynamic";

// next/dynamic with ssr: false is not allowed in a Server Component, hence this wrapper.
export const AssetsCurveChart = dynamic(
  () => import("./assets-curve-chart").then((m) => m.AssetsCurveChart),
  { ssr: false, loading: () => <div className="skeleton" style={{ height: 200 }} /> }
);
