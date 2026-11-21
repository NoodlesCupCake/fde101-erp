import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SqlBlock } from "@/components/sql-block";
import { getCurrentEmployee } from "@/lib/dal";
import { id as toId, one } from "@/lib/filters";
import { date, num, thb } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { Status } from "../data";

/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (n: number | string | null) => (n == null ? "–" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * One order and its document flow. Row Level Security decides whether this user may see it: another rep's order
 * simply isn't returned, so changing the id in the URL gives "not found" (and the API gives an empty result).
 */
export default async function SalesOrder({ params, searchParams }: PageProps<"/sales-orders/[id]">) {
  await getCurrentEmployee();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const oid = toId(id);
  if (!oid) notFound();
  const supabase = await createClient();
  const { data: o } = await supabase.from("sales_orders")
    .select("*, customers(customer_code, name, segment, payment_terms_days, credit_limit), warehouses(code, name), rep:employees(employee_code, first_name, last_name, job_title)")
    .eq("sales_order_id", oid).maybeSingle<any>();
  if (!o) notFound();
  const [lines, delivery, invoice] = await Promise.all([
    supabase.from("sales_order_lines").select("*, products(sku, name, uom, list_price)").eq("sales_order_id", oid).order("line_no").returns<any[]>(),
    supabase.from("deliveries").select("*").eq("sales_order_id", oid).maybeSingle<any>(),
    supabase.from("sales_invoices").select("*, customer_payments(*)").eq("sales_order_id", oid).maybeSingle<any>(),
  ]);
  const ls = lines.data ?? [];
  const d = delivery.data, inv = invoice.data;
  const pays = ((inv?.customer_payments ?? []) as any[]).sort((a, b) => a.payment_date.localeCompare(b.payment_date));
  const paid = pays.reduce((s, p) => s + Number(p.amount), 0);
  // hand calculation from the lines, to show next to the stored totals
  const handSub = Math.round(ls.reduce((s, l) => s + Math.round(l.quantity * l.unit_price * (1 - l.discount_pct / 100) * 100) / 100, 0) * 100) / 100;
  const handVat = Math.round(handSub * 0.07 * 100) / 100;
  const backorder = one(sp, "backorder");

  return (
    <div className="space-y-5">
      <Link href="/sales-orders" className="text-sm text-brand hover:underline">← Sales orders</Link>
      {sp.created && (
        <p role="status" className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">
          Order {o.order_number} created. Totals were computed in the database from products.list_price.
        </p>
      )}
      {backorder && (
        <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          Not enough stock in {o.warehouses?.code} for <b className="font-mono">{backorder.split(",").join(", ")}</b>. The order is a <b>backorder</b>:
          it stays open and ships when stock arrives (or is cancelled after 30 days).
        </p>
      )}
      <div>
        <h1 className="text-xl font-semibold"><span className="font-mono">{o.order_number}</span> <Status s={o.status} /></h1>
        <p className="text-sm text-muted">
          {o.customers?.name} <span className="font-mono text-xs">{o.customers?.customer_code}</span> · {o.customers?.segment} ·
          rep {o.rep?.first_name} {o.rep?.last_name} ({o.rep?.employee_code}) · ships from {o.warehouses?.code} ·
          ordered {date(o.order_date)}, requested {date(o.requested_date)}
        </p>
        {o.status === "CANCELLED" && <p className="text-sm text-danger">Cancelled {date(o.cancelled_date)}: {o.cancel_reason}</p>}
      </div>

      <section className="rounded-xl border border-line bg-surface">
        <h2 className="border-b border-line px-5 py-3 font-semibold">Lines</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr><th className="px-4 py-2 font-medium">#</th><th className="px-4 py-2 font-medium">Product</th><th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 text-right font-medium">Unit price</th><th className="px-4 py-2 text-right font-medium">Discount</th>
                <th className="px-4 py-2 text-right font-medium">Amount (excl. VAT)</th></tr>
            </thead>
            <tbody>
              {ls.map((l) => (
                <tr key={l.sales_order_line_id} className="border-t border-line tabular-nums">
                  <td className="px-4 py-2 text-muted">{l.line_no}</td>
                  <td className="px-4 py-2"><span className="font-mono text-xs">{l.products?.sku}</span> {l.products?.name}</td>
                  <td className="px-4 py-2 text-right">{num(l.quantity)} {l.products?.uom}</td>
                  <td className="px-4 py-2 text-right">{money(l.unit_price)}</td>
                  <td className="px-4 py-2 text-right">{Number(l.discount_pct)}%</td>
                  <td className="px-4 py-2 text-right">{money(l.line_amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="tabular-nums">
              {[["Subtotal", o.subtotal, handSub], ["VAT 7%", o.vat_amount, handVat], ["Total", o.total_amount, Math.round((handSub + handVat) * 100) / 100]].map(([l, v, h]) => (
                <tr key={l as string} className="border-t border-line">
                  <td colSpan={5} className="px-4 py-1.5 text-right font-medium">{l}</td>
                  <td className="px-4 py-1.5 text-right font-semibold">{money(v as number)}
                    <div className={`text-xs font-normal ${Math.abs(Number(v) - (h as number)) < 0.005 ? "text-ok" : "text-danger"}`}>{Math.abs(Number(v) - (h as number)) < 0.005 ? "✓" : "≠"} by hand {money(h as number)}</div></td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </section>

      <ol className="grid gap-3 md:grid-cols-4">
        <Step n={1} title="Order" done>{o.order_number} · {date(o.order_date)}<br />{thb(o.total_amount)}</Step>
        <Step n={2} title="Delivery" done={!!d}>{d ? <>{d.delivery_number} · shipped {date(d.ship_date)}</> : o.status === "CANCELLED" ? "never shipped" : "waiting for stock / picking"}</Step>
        <Step n={3} title="Invoice" done={!!inv}>{inv ? <>{inv.invoice_number} · {date(inv.invoice_date)}<br />due {date(inv.due_date)} <Status s={inv.status} /></> : "after delivery"}</Step>
        <Step n={4} title="Payment" done={pays.length > 0}>
          {pays.map((p) => <div key={p.payment_id}>{p.payment_number} · {date(p.payment_date)} · {thb(p.amount)} {p.method.toLowerCase()}</div>)}
          {inv && <div className="text-muted">outstanding {thb(Number(inv.total_amount) - paid)}</div>}
          {!inv && "after the invoice"}
        </Step>
      </ol>

      <SqlBlock title={`check ${o.order_number} by hand`} note="Recompute the totals from the lines: they must equal the stored subtotal / vat_amount / total_amount." sql={`-- Totals of ${o.order_number} recomputed from its lines
select o.order_number,
       o.subtotal,                                         round(sum(l.quantity * l.unit_price * (1 - l.discount_pct / 100)), 2) as subtotal_by_hand,
       o.vat_amount,                                       round(round(sum(l.quantity * l.unit_price * (1 - l.discount_pct / 100)), 2) * 0.07, 2) as vat_by_hand,
       o.total_amount
from sales_orders o join sales_order_lines l using (sales_order_id)
where o.order_number = '${o.order_number}'
group by o.sales_order_id;

-- Each line: price must be the product's list price
select l.line_no, p.sku, l.quantity, l.unit_price, p.list_price, l.discount_pct, l.line_amount,
       round(l.quantity * l.unit_price * (1 - l.discount_pct / 100), 2) as line_by_hand
from sales_order_lines l join products p using (product_id) join sales_orders o using (sales_order_id)
where o.order_number = '${o.order_number}' order by l.line_no;`} />
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <li className={`rounded-xl border bg-surface p-4 text-sm ${done ? "border-line" : "border-dashed border-line text-muted"}`}>
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${done ? "bg-ok/15 text-ok" : "bg-background"}`}>{done ? "✓" : n}</span>{title}
      </div>
      {children}
    </li>
  );
}
