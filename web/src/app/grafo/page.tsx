import { Suspense } from "react";
import Link from "next/link";
import { GraphCanvas } from "@/components/graph-canvas";

export const dynamic = "force-dynamic";

export default function GrafoPage() {
  return (
    <main className="flex h-screen flex-col">
      <header className="flex flex-none items-center gap-4 border-b border-white/[0.07] px-6 py-3">
        <Link href="/" className="mono-label hover:text-white/60">
          ← início
        </Link>
        <div className="h-4 w-px bg-white/10" />
        <div>
          <div className="mono-label !text-white/45">grafo de correlações</div>
        </div>
      </header>
      {/* GraphCanvas reads ?add= via useSearchParams, which Next requires a
          Suspense boundary around. */}
      <Suspense fallback={null}>
        <GraphCanvas />
      </Suspense>
    </main>
  );
}
