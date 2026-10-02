export function EmptyState({
  icon = "◌", title, hint, compact = false,
}: {
  icon?: string;
  title: React.ReactNode;
  hint?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? " empty-state--compact" : ""}`}>
      <div className="empty-state__icon" aria-hidden>{icon}</div>
      <div className="empty-state__title">{title}</div>
      {hint ? <div className="empty-state__hint">{hint}</div> : null}
    </div>
  );
}
