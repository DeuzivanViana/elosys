import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 p-4" style={{ borderBottom: "1px solid var(--border-1)" }}>
        <Skeleton className="h-9 flex-1" style={{ borderRadius: "var(--r-md)", minWidth: 220 }} />
        <Skeleton className="h-9 w-40" style={{ borderRadius: "var(--r-md)" }} />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <Skeleton className="h-3 w-56" />
      </div>
    </main>
  );
}
