import Link from "next/link";
import { SqlBlock } from "@/components/sql-block";
import { date, num, thb } from "@/lib/format";
import { requireProcurement, Status } from "../data";
import { holdSql } from "../sql";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Supplier invoices on hold. Three-way match: the invoice (billed qty × price) against the goods receipt
 * (accepted qty) and the PO (agreed price). A mismatch outside tolerance is an EXCEPTION and stays ON_HOLD until resolved.
 */
export default async function InvoicesOnHold() {
  const { supabase } = await requireProcurement();
  const [{ data }, { count: exceptions }] = await Promise.all([
    supabase.from("supplier_invoices")
      .select("supplier_invoice_id, document_number, supplier_invoice_ref, invoice_date, due_date, billed_subtotal, receipt_value, match_status, exception_type, hold_reason, status, suppliers(name), purchase_orders(purchase_order_id, po_number), goods_receipts(gr_number, receipt_date), supplier_invoice_lines(line_no, quantity_billed, quantity_accepted, unit_price_billed, po_unit_cost, line_amount_billed, match_result, products(sku, name))")
      .eq("status", "ON_HOLD").order("invoice_date").returns<any[]>(),
    supabase.from("supplier_invoices").select("supplier_invoice_id", { count: "exact", head: true }).eq("match_status", "EXCEPTION"),
  ]);
  const rows = data ?? [];
  const held = rows.reduce((s, r) => s + Number(r.billed_subtotal), 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Supplier invoices on hold ({rows.length})</h1>
        <p className="text-sm text-muted">
          Three-way match compares the purchase order (price), the goods receipt (accepted quantity) and the supplier invoice.
          These failed and are not resolved yet, so they can&apos;t be paid. {thb(held)} billed is waiting. ({num(exceptions)} exceptions in total; the rest were resolved.)
        </p>
      </div>
      <SqlBlock title="behind this list" sql={holdSql} />
      {rows.map((r) => {
        const diff = Number(r.billed_subtotal) - Number(r.receipt_value);
        return (
          <section key={r.supplier_invoice_id} className="rounded-xl border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
              <div>
                <span className="font-mono font-medium">{r.document_number}</span> <span className="text-sm text-muted">ref {r.supplier_invoice_ref} · {r.suppliers?.name} · {date(r.invoice_date)}</span>
                {" "}<Status s={r.match_status} /> <Status s={r.status} />
              </div>
              <Link href={`/procurement/${r.purchase_orders?.purchase_order_id}`} className="font-mono text-sm text-brand hover:underline">{r.purchase_orders?.po_number} →</Link>
            </div>
            <div className="space-y-3 px-5 py-3 text-sm">
              <p><b className="text-danger">{(r.exception_type ?? "").replace(/_/g, " ").toLowerCase()} exception</b>: “{r.hold_reason}”</p>
              <p className="text-muted">Billed {thb(r.billed_subtotal)} · goods receipt {r.goods_receipts?.gr_number} says we owe {thb(r.receipt_value)} ·
                difference <span className={diff > 0 ? "font-medium text-danger" : ""}>{diff > 0 ? "+" : ""}{thb(diff)}</span></p>
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-background/50 text-left text-xs text-muted">
                    <tr><th className="px-3 py-1.5 font-medium">Product</th><th className="px-3 py-1.5 text-right font-medium">Billed qty</th><th className="px-3 py-1.5 text-right font-medium">Accepted (GR)</th>
                      <th className="px-3 py-1.5 text-right font-medium">Billed price</th><th className="px-3 py-1.5 text-right font-medium">PO price</th><th className="px-3 py-1.5 font-medium">Result</th></tr>
                  </thead>
                  <tbody>
                    {r.supplier_invoice_lines.sort((a: any, b: any) => a.line_no - b.line_no).map((l: any) => (
                      <tr key={l.line_no} className="border-t border-line tabular-nums">
                        <td className="px-3 py-1.5"><span className="font-mono text-xs">{l.products?.sku}</span> <span className="text-muted">{l.products?.name}</span></td>
                        <td className={`px-3 py-1.5 text-right ${l.quantity_billed !== l.quantity_accepted ? "font-medium text-danger" : ""}`}>{num(l.quantity_billed)}</td>
                        <td className="px-3 py-1.5 text-right">{num(l.quantity_accepted)}</td>
                        <td className={`px-3 py-1.5 text-right ${Number(l.unit_price_billed) !== Number(l.po_unit_cost) ? "font-medium text-danger" : ""}`}>{Number(l.unit_price_billed).toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right">{Number(l.po_unit_cost).toFixed(2)}</td>
                        <td className={`px-3 py-1.5 text-xs font-medium ${l.match_result === "OK" ? "text-ok" : "text-danger"}`}>{l.match_result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}
      {rows.length === 0 && <p className="text-sm text-muted">No invoices on hold.</p>}
    </div>
  );
}
