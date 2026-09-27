import { Suspense } from "react";
import { GraphCanvas } from "@/components/graph-canvas";
import { PageHeader } from "@/components/shell/shell-context";

export const dynamic = "force-dynamic";

export default function GrafoPage() {
  return (
    <main className="flex h-full flex-col">
      <PageHeader group="EloSys" current="Grafo de correlações" />
      {/* GraphCanvas reads ?add= via useSearchParams, which Next requires a
          Suspense boundary around. */}
      <Suspense fallback={null}>
        <GraphCanvas />
      </Suspense>
    </main>
  );
}
