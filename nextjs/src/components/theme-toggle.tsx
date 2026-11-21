"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light/dark switch. The new theme spreads out from the click point like a droplet (View Transitions API). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(currentTheme()), []);

  function apply(next: Theme) {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* private mode */ }
    setTheme(next);
  }

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduce) return apply(next);

    const x = e.clientX || innerWidth / 2;
    const y = e.clientY || innerHeight / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const root = document.documentElement;
    root.classList.add("theme-switching");
    const t = document.startViewTransition(() => flushSync(() => apply(next)));
    t.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r * 0.08}px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`],
          offset: [0, 0.18, 1] },
        { duration: 750, easing: "cubic-bezier(.65,0,.35,1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
    t.finished.finally(() => root.classList.remove("theme-switching"));
  }

  const dark = theme === "dark";
  return (
    <button type="button" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={`flex size-9 items-center justify-center rounded-md border border-line hover:bg-background ${className}`}>
      {theme === null ? null : dark ? (
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      )}
    </button>
  );
}
