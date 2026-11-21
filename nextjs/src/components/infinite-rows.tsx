"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type MoreRows = { rows: ReactNode; next: string | null };

/**
 * Infinite scroll for a <tbody>: the server renders page 1; when the sentinel row scrolls near the viewport,
 * `load(cursor)` (a Server Action) returns the next rows already rendered, plus the next cursor.
 * Rows are appended with a plain state update (not a transition), so the page-level view transition doesn't replay.
 */
export function InfiniteRows({ next, load, colSpan }: { next: string | null; load: (cursor: string) => Promise<MoreRows>; colSpan: number }) {
  const [chunks, setChunks] = useState<ReactNode[]>([]);
  const [cursor, setCursor] = useState(next);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const sentinel = useRef<HTMLTableRowElement>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const r = await load(cursor);
      setChunks((c) => [...c, r.rows]);
      setCursor(r.next);
    } catch {
      setError("Couldn't load more rows.");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [cursor, load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || error) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore, error]);

  return (
    <>
      {chunks.map((c, i) => <Fragment key={i}>{c}</Fragment>)}
      <tr ref={sentinel}>
        <td colSpan={colSpan} className="px-4 py-4 text-center text-sm text-muted">
          {error ? (
            <button onClick={loadMore} className="text-danger hover:underline">{error} Try again</button>
          ) : cursor ? (
            loading ? <span className="inline-flex items-center gap-2"><span className="size-3 animate-spin rounded-full border-2 border-muted border-t-transparent" /> Loading…</span>
              : <button onClick={loadMore} className="hover:text-foreground hover:underline">Load more</button>
          ) : (
            "That's everything."
          )}
        </td>
      </tr>
    </>
  );
}
