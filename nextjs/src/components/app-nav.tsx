"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type NavItem = { href: string; label: string };

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

/** One row: main links, plus a "More" menu for the rest. Scrolls sideways on small screens instead of wrapping. */
export function AppNav({ main, more }: { main: NavItem[]; more: NavItem[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("mousedown", close);
    addEventListener("keydown", close);
    return () => { removeEventListener("mousedown", close); removeEventListener("keydown", close); };
  }, [open]);

  const link = (n: NavItem, extra = "") => (
    <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined}
      className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${extra} ${
        isActive(path, n.href) ? "bg-brand/10 font-medium text-brand" : "text-muted hover:bg-background hover:text-foreground"}`}>
      {n.label}
    </Link>
  );
  const moreActive = more.some((n) => isActive(path, n.href));

  return (
    <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
      {main.map((n) => link(n))}
      <div ref={ref} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${moreActive ? "bg-brand/10 font-medium text-brand" : "text-muted hover:bg-background hover:text-foreground"}`}>
          More ▾
        </button>
        {open && (
          <div role="menu" className="fixed z-50 mt-1 w-48 rounded-lg border border-line bg-surface p-1 shadow-lg">
            {more.map((n) => link(n, "block"))}
          </div>
        )}
      </div>
    </nav>
  );
}
