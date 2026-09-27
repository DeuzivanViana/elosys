/** Shimmer placeholder shown while a section's data is still in flight
 * (client fetch, or a server section streamed in behind <Suspense>). */
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden />;
}
