import Link from "next/link";

/** Previous / Next links for cursor pagination. `base` is the page path; `extra` keeps other query params. */
export function Pager({ base, prev, next, extra = {} }: { base: string; prev: string | null; next: string | null; extra?: Record<string, string> }) {
  const href = (k: "after" | "before", v: string) => `${base}?${new URLSearchParams({ ...extra, [k]: v })}`;
  const cls = "rounded-md border border-line px-3 py-1 text-sm hover:bg-background";
  const off = "rounded-md border border-line px-3 py-1 text-sm opacity-40";
  return (
    <div className="flex items-center gap-2">
      {prev ? <Link className={cls} href={href("before", prev)}>← Previous</Link> : <span className={off}>← Previous</span>}
      {next ? <Link className={cls} href={href("after", next)}>Next →</Link> : <span className={off}>Next →</span>}
    </div>
  );
}
