/** Shown instantly while a page's server data loads (keeps navigation feeling fast). */
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="h-7 w-48 animate-pulse rounded-md bg-line" />
      <div className="rounded-xl border border-line bg-surface p-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-4 py-2.5">
            <div className="h-4 w-24 animate-pulse rounded bg-line" />
            <div className="h-4 flex-1 animate-pulse rounded bg-line" style={{ animationDelay: `${i * 60}ms` }} />
            <div className="h-4 w-20 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>
    </div>
  );
}
