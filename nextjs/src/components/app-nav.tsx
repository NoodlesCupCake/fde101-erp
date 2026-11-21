"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

export type NavItem = { href: string; label: string; icon: string };
export type NavGroup = { title?: string; items: NavItem[] };

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

/** Left sidebar on desktop; on phones a top bar with ☰ opens it as a drawer. */
export function Sidebar({ groups, footer }: { groups: NavGroup[]; footer: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [open]);

  const brand = (
    <Link href="/" className="flex items-center gap-2 font-semibold">
      <span className="flex size-8 items-center justify-center rounded-md bg-brand text-white" aria-hidden>A</span>
      A-ERP
    </Link>
  );

  return (
    <>
      {/* phone top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 md:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}
          className="flex size-9 items-center justify-center rounded-md border border-line">☰</button>
        {brand}
      </div>
      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-surface transition-transform md:sticky md:top-0 md:z-auto md:h-dvh md:w-60 md:shrink-0 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-4 py-4">
          {brand}
          <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="text-muted md:hidden">✕</button>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4" aria-label="Main">
          {groups.map((g, i) => (
            <div key={i}>
              {g.title && <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted">{g.title}</div>}
              <ul className="space-y-0.5">
                {g.items.map((n) => {
                  const active = isActive(path, n.href);
                  return (
                    <li key={n.href}>
                      <Link href={n.href} aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                          active ? "bg-brand/10 font-medium text-brand" : "text-muted hover:bg-background hover:text-foreground"}`}>
                        <span className="w-4 text-center" aria-hidden>{n.icon}</span>{n.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-3">{footer}</div>
      </aside>
    </>
  );
}
