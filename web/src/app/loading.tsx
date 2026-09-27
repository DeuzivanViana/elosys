import { Skeleton } from "@/components/skeleton";

/** Next.js wraps `page.tsx` in a <Suspense> automatically when a sibling
 * `loading.tsx` exists — this is what shows the instant the route is hit,
 * swapped out for the real page the moment its data resolves. Shaped like
 * the home page itself so the swap doesn't jump around. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-10">
      <div className="rounded-[var(--r-page)] border border-[var(--border-1)] px-6 py-16 sm:px-12 sm:py-20">
        <div className="max-w-2xl">
          <Skeleton className="h-3 w-56" />
          <Skeleton className="mt-4 h-11 w-full" />
          <Skeleton className="mt-2 h-11 w-3/4" />
          <Skeleton className="mt-5 h-4 w-full" />
          <Skeleton className="mt-1.5 h-4 w-2/3" />
          <Skeleton className="mt-8 h-11 w-full" style={{ borderRadius: "var(--r-md)" }} />
        </div>
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20" style={{ borderRadius: "var(--r-md)" }} />
          ))}
        </div>
        <div className="kpis">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="kpi">
              <Skeleton className="h-2.5 w-2/3" />
              <Skeleton className="mt-2 h-5 w-4/5" />
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <Skeleton className="h-3 w-72" />
        <Skeleton className="mt-3 h-5 w-96" />
        <div className="mt-6 flex flex-col">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border-b border-[var(--border-1)] py-3.5 last:border-0">
              <div className="flex items-center gap-3">
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-3.5 w-24 flex-none" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
