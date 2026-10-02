import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-4xl pt-8">
      <header className="pb-8">
        <Skeleton className="h-9 w-80" />
        <Skeleton className="mt-3 h-4 w-56" />
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="kpis mt-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="kpi">
              <Skeleton className="h-2.5 w-2/3" />
              <Skeleton className="mt-2 h-5 w-4/5" />
              <Skeleton className="mt-1.5 h-2.5 w-1/2" />
            </div>
          ))}
        </div>
      </header>

      <section className="py-7">
        <Skeleton className="mb-4 h-6 w-64" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[68px] w-full" style={{ borderRadius: "var(--r-md)" }} />
          ))}
        </div>
      </section>
    </main>
  );
}
