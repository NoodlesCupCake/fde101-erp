"use client";

import { useMemo, useRef, useState } from "react";

export type MonthPoint = { month: string; warehouse: string; stock_value: number };

// Categorical slots 1-3 of the validated reference palette (fixed order, follows the warehouse, never its rank).
const SERIES_VAR = ["--series-1", "--series-2", "--series-3"];
const W = 760, H = 260, PAD = { l: 52, r: 64, t: 12, b: 28 };
const fmtM = (v: number) => `฿${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
const fmtFull = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "THB", maximumFractionDigits: 0 });
const monthLabel = (m: string) => new Date(m + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

/** Month-end stock value by warehouse: one line per warehouse, crosshair tooltip, legend, and a table view. */
export function ValueChart({ data, warehouses }: { data: MonthPoint[]; warehouses: string[] }) {
  const months = useMemo(() => [...new Set(data.map((d) => d.month))].sort(), [data]);
  const byWh = useMemo(() => warehouses.map((w) => months.map((m) => Number(data.find((d) => d.warehouse === w && d.month === m)?.stock_value ?? 0))), [data, months, warehouses]);
  const max = Math.max(1, ...byWh.flat());
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const x = (i: number) => PAD.l + (i / Math.max(1, months.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  function onMove(e: React.PointerEvent) {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (months.length - 1));
    setHover(Math.min(months.length - 1, Math.max(0, i)));
  }

  return (
    <div className="viz-root space-y-2">
      <div className="flex flex-wrap gap-4 text-xs text-muted" aria-label="Legend">
        {warehouses.map((w, s) => (
          <span key={w} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: `var(${SERIES_VAR[s]})` }} aria-hidden />{w}
          </span>
        ))}
      </div>
      <div className="relative">
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" role="img"
          aria-label="Month-end stock value by warehouse" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">{fmtM(t)}</text>
            </g>
          ))}
          {months.map((m, i) => (i % 3 === 0 || i === months.length - 1) && (
            <text key={m} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{monthLabel(m)}</text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />}
          {byWh.map((vals, s) => (
            <g key={warehouses[s]}>
              <polyline fill="none" stroke={`var(${SERIES_VAR[s]})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                points={vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
              {/* direct label at the line end; text stays in text ink, the dot carries identity */}
              <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r={4} fill={`var(${SERIES_VAR[s]})`} stroke="var(--surface)" strokeWidth={2} />
              <text x={x(vals.length - 1) + 8} y={y(vals[vals.length - 1])} dy="0.32em" fontSize={11} fill="var(--foreground)">{warehouses[s]}</text>
              {hover !== null && <circle cx={x(hover)} cy={y(vals[hover])} r={4} fill={`var(${SERIES_VAR[s]})`} stroke="var(--surface)" strokeWidth={2} />}
            </g>
          ))}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md"
            style={{ left: `min(calc(${(x(hover) / W) * 100}% + 12px), calc(100% - 11rem))` }}>
            <div className="mb-1 font-medium">{monthLabel(months[hover])} month-end</div>
            {warehouses.map((w, s) => (
              <div key={w} className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: `var(${SERIES_VAR[s]})` }} />{w}</span>
                <span className="tabular-nums">{fmtFull(byWh[s][hover])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted hover:text-foreground">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted"><tr><th className="py-1 pr-4">Month</th>{warehouses.map((w) => <th key={w} className="py-1 pr-4 text-right">{w}</th>)}</tr></thead>
            <tbody>
              {months.map((m, i) => (
                <tr key={m} className="border-t border-line">
                  <td className="py-1 pr-4">{monthLabel(m)}</td>
                  {byWh.map((vals, s) => <td key={s} className="py-1 pr-4 text-right tabular-nums">{fmtFull(vals[i])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
