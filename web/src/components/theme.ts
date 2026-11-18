import { useEffect, useState } from "react";

const KEYS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-grid", "muted-foreground", "card", "border", "foreground", "destructive", "warning", "success"] as const;
type Key = (typeof KEYS)[number];

function read(): Record<Key, string> {
  const s = getComputedStyle(document.documentElement);
  return Object.fromEntries(KEYS.map((k) => [k, s.getPropertyValue(`--${k}`).trim()])) as Record<Key, string>;
}

/** Resolved design-token colors for SVG charts (Recharts needs concrete values); follows light/dark changes. */
export function useChartColors() {
  const [c, setC] = useState(read);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setC(read());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return c;
}

export function useReducedMotion() {
  const [r, setR] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return r;
}
