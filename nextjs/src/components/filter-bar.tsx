"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addTransitionType, startTransition, useEffect, useRef, useState } from "react";

export type Field =
  | { name: string; type: "search"; placeholder: string }
  | { name: string; type: "select"; label: string; options: { value: string; label: string }[] }
  | { name: string; type: "date"; label: string };

const cls = "h-9 rounded-md border border-line bg-surface px-3 text-sm";

/**
 * Filters live in the URL, so a filtered view can be shared or bookmarked, and the server reads the same values.
 * Search updates while you type (debounced). Updates use the "filter" transition type, which the layout maps to
 * no animation, so the list just refreshes in place.
 */
export function FilterBar({ fields }: { fields: Field[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchField = fields.find((f) => f.type === "search");
  const [text, setText] = useState(searchField ? sp.get(searchField.name) ?? "" : "");

  function apply(name: string, value: string) {
    const next = new URLSearchParams(sp);
    if (value) next.set(name, value); else next.delete(name);
    next.delete("after"); next.delete("before");
    const qs = next.toString();
    setPending(true);
    startTransition(() => {
      addTransitionType("filter");
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }
  useEffect(() => setPending(false), [sp]);

  const active = fields.some((f) => sp.get(f.name));

  return (
    <div className="flex flex-wrap items-center gap-2" role="search">
      {fields.map((f) => {
        if (f.type === "search") {
          return (
            <input key={f.name} type="search" value={text} placeholder={f.placeholder} aria-label={f.placeholder}
              className={`${cls} w-full sm:w-64`}
              onChange={(e) => {
                const v = e.target.value;
                setText(v);
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => apply(f.name, v.trim()), 300);
              }} />
          );
        }
        if (f.type === "select") {
          return (
            <select key={f.name} aria-label={f.label} value={sp.get(f.name) ?? ""} className={cls} onChange={(e) => apply(f.name, e.target.value)}>
              <option value="">{f.label}: all</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          );
        }
        return (
          <label key={f.name} className="flex items-center gap-1.5 text-sm text-muted">
            {f.label}
            <input type="date" value={sp.get(f.name) ?? ""} className={cls} onChange={(e) => apply(f.name, e.target.value)} />
          </label>
        );
      })}
      {active && (
        <button type="button" className="h-9 px-2 text-sm text-brand hover:underline"
          onClick={() => { setText(""); startTransition(() => { addTransitionType("filter"); router.replace(pathname, { scroll: false }); }); }}>
          Clear
        </button>
      )}
      {pending && <span className="size-4 animate-spin rounded-full border-2 border-muted border-t-transparent" aria-label="Updating" />}
    </div>
  );
}
