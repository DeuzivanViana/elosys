import { Skeleton } from "@/components/skeleton";

export function EntityLoadingSkeleton() {
  return (
    <main className="mx-auto w-full max-w-4xl">
      <header className="border-b border-[var(--border-1)] pb-8">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-9 w-64" />
        <Skeleton className="mt-2 h-4 w-48" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Skeleton className="h-5 w-28" style={{ borderRadius: "var(--r-sm)" }} />
          <Skeleton className="h-5 w-36" style={{ borderRadius: "var(--r-sm)" }} />
        </div>
      </header>

      <section className="py-10">
        <Skeleton className="h-3 w-56" />
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="mt-2 h-3.5 w-24" />
            </div>
          ))}
        </div>
      </section>

      <section className="py-6">
        <div className="table-wrap">
          <div className="p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-[var(--border-1)] py-3 last:border-0">
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-20" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
