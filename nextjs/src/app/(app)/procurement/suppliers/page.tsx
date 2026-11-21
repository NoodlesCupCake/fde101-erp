import Link from "next/link";
import { SqlBlock } from "@/components/sql-block";
import { num } from "@/lib/format";
import { requireProcurement } from "../data";
import { scorecardSql } from "../sql";

type Row = {
  supplier_id: number; supplier_code: string; supplier: string; purchase_orders: number; receipts: number; on_time_receipts: number;
  on_time_pct: number | null; units_received: number; units_rejected: number; rejection_pct: number | null;
  invoices: number; invoice_exceptions: number; exception_pct: number | null; on_hold: number;
};

const pct = (v: number | null, d = 1) => (v == null ? "–" : `${Number(v).toFixed(d)}%`);

/** Stretch: supplier scorecard, computed in the database (supplier_scorecard()). Worst on-time first. */
export default async function SupplierScorecard() {
  const { supabase } = await requireProcurement();
  const { data, error } = await supabase.rpc("supplier_scorecard");
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Row[]).sort((a, b) => (a.on_time_pct ?? 101) - (b.on_time_pct ?? 101));
  const tot = rows.reduce((s, r) => ({ rec: s.rec + r.receipts, on: s.on + r.on_time_receipts, u: s.u + r.units_received, rj: s.rj + r.units_rejected, i: s.i + r.invoices, x: s.x + r.invoice_exceptions }),
    { rec: 0, on: 0, u: 0, rj: 0, i: 0, x: 0 });
  const bar = (v: number | null, bad: boolean) => (
    <div className="ml-auto h-1.5 w-20 rounded-full bg-background"><div className={`h-1.5 rounded-full ${bad ? "bg-danger" : "bg-brand"}`} style={{ width: `${Math.min(Number(v ?? 0), 100)}%` }} /></div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Supplier scorecard</h1>
        <p className="text-sm text-muted">On time = goods receipt date ≤ PO expected date (per delivery). Rejection = units rejected at the dock ÷ delivered. Exceptions = invoices that failed the three-way match.</p>
      </div>
      <section className="grid grid-cols-3 gap-3">
        {[{ l: "On time, all suppliers", v: pct((100 * tot.on) / (tot.rec || 1)) }, { l: "Rejection rate", v: pct((100 * tot.rj) / (tot.u || 1), 2) }, { l: "Invoice exceptions", v: pct((100 * tot.x) / (tot.i || 1)) }].map((k) => (
          <div key={k.l} className="rounded-xl border border-line bg-surface p-4"><div className="text-sm text-muted">{k.l}</div><div className="mt-1 text-xl font-semibold tabular-nums">{k.v}</div></div>
        ))}
      </section>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr><th className="px-4 py-2 font-medium">Supplier</th><th className="px-4 py-2 text-right font-medium">POs</th>
              <th className="px-4 py-2 text-right font-medium" colSpan={2}>On time</th>
              <th className="px-4 py-2 text-right font-medium" colSpan={2}>Rejected units</th>
              <th className="px-4 py-2 text-right font-medium" colSpan={2}>Invoice exceptions</th><th className="px-4 py-2 text-right font-medium">On hold</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.supplier_id} className="border-t border-line tabular-nums">
                <td className="px-4 py-2"><Link href={`/procurement?supplier=${r.supplier_id}`} className="font-medium text-brand hover:underline">{r.supplier}</Link> <span className="font-mono text-xs text-muted">{r.supplier_code}</span></td>
                <td className="px-4 py-2 text-right">{num(r.purchase_orders)}</td>
                <td className="px-4 py-2 text-right">{pct(r.on_time_pct)} <span className="text-xs text-muted">{num(r.on_time_receipts)}/{num(r.receipts)}</span></td>
                <td className="w-24 py-2 pr-4">{bar(r.on_time_pct, (r.on_time_pct ?? 100) < 80)}</td>
                <td className="px-4 py-2 text-right">{pct(r.rejection_pct, 2)} <span className="text-xs text-muted">{num(r.units_rejected)}/{num(r.units_received)}</span></td>
                <td className="w-24 py-2 pr-4">{bar((r.rejection_pct ?? 0) * 10, (r.rejection_pct ?? 0) > 2)}</td>
                <td className="px-4 py-2 text-right">{pct(r.exception_pct)} <span className="text-xs text-muted">{num(r.invoice_exceptions)}/{num(r.invoices)}</span></td>
                <td className="w-24 py-2 pr-4">{bar(r.exception_pct, (r.exception_pct ?? 0) > 20)}</td>
                <td className={`px-4 py-2 text-right ${r.on_hold ? "font-medium text-danger" : "text-muted"}`}>{num(r.on_hold)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Red bars: on time under 80%, rejection over 2% (bar is scaled ×10), exceptions over 20%. Click a supplier for its purchase orders.</p>
      <SqlBlock title="behind this scorecard" sql={scorecardSql} />
    </div>
  );
}
