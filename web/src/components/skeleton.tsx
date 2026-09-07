/** shadcn-style shimmer placeholder. Use while a client component is
 * fetching, sized to roughly match the real content it replaces. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-sm bg-white/[0.06] ${className}`} aria-hidden />;
}
