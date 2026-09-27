import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <Skeleton className="h-3 w-80" />
        <Skeleton className="mt-3 h-7 w-96" />
        <Skeleton className="mt-4 h-4 w-full max-w-2xl" />
        <Skeleton className="mt-1.5 h-4 w-2/3 max-w-2xl" />
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24" style={{ borderRadius: "var(--r-md)" }} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="tweet-card">
            <Skeleton className="h-10 w-10 flex-none" style={{ borderRadius: 999 }} />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="mt-2.5 h-3.5 w-full" />
              <Skeleton className="mt-1.5 h-3.5 w-2/3" />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
