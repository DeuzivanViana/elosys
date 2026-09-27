import { Skeleton } from "@/components/skeleton";

/** Shared shape for the four /sinais/* listing pages' loading.tsx — header
 * + filter row + a stack of signal-card placeholders. */
export function SinaisLoadingSkeleton({ filterCount = 4 }: { filterCount?: number }) {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <Skeleton className="h-3 w-80" />
        <Skeleton className="mt-3 h-7 w-96" />
        <Skeleton className="mt-4 h-4 w-full max-w-2xl" />
        <Skeleton className="mt-1.5 h-4 w-2/3 max-w-2xl" />
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {Array.from({ length: filterCount }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24" style={{ borderRadius: "var(--r-md)" }} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="signal signal--medium">
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="mt-3 h-3.5 w-full" />
            <Skeleton className="mt-1.5 h-3.5 w-2/3" />
          </div>
        ))}
      </section>
    </div>
  );
}
