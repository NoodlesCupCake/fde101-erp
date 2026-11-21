import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SqlBlock } from "@/components/sql-block";
import { id } from "@/lib/filters";
import { date, num, thb } from "@/lib/format";
import { LEVEL_LABEL, requireProcurement, Status } from "../data";
import { poFlowSql } from "../sql";

type Person = { employee_code: string; first_name: string; last_name: string; job_title?: string } | null;
const who = (p: Person) => (p ? `${p.first_name} ${p.last_name} (${p.employee_code}${p.job_title ? ` · ${p.job_title}` : ""})` : "–");
type Prod = { sku: string; name: string; uom?: string } | null;

/* eslint-disable @typescript-eslint/no-explicit-any */
/** One purchase order and every document around it, in the order they happened. */
export default async function PurchaseOrder({ params }: PageProps<"/procurement/[poId]">) {
  const { supabase } = await requireProcurement();
  const poId = id((await params).poId);
  if (!poId) notFound();

  const { data: po } = await supabase.from("purchase_orders")
    .select("*, suppliers(supplier_code, name, payment_terms_days), warehouses(code, name), buyer:employees(employee_code, first_name, last_name, job_title)")
    .eq("purchase_order_id", poId).maybeSingle<any>();
  if (!po) notFound();
  const person = "employee_code, first_name, last_name, job_title";
  const [req, lines, receipts, invoices] = await Promise.all([
    supabase.from("purchase_requisitions")
      .select(`*, requester:employees!purchase_requisitions_requested_by_fkey(${person}), approver:employees!purchase_requisitions_approver_id_fkey(${person}), purchase_requisition_lines(line_no, quantity, estimated_unit_cost, products(sku, name))`)
      .eq("requisition_id", po.requisition_id).maybeSingle<any>(),
    supabase.from("purchase_order_lines").select("*, products(sku, name, uom)").eq("purchase_order_id", poId).order("line_no").returns<any[]>(),
    supabase.from("goods_receipts").select(`*, receiver:employees(${person}), goods_receipt_lines(*, products(sku, name))`)
      .eq("purchase_order_id", poId).order("delivery_no").returns<any[]>(),
    supabase.from("supplier_invoices").select(`*, approver:employees(${person}), supplier_invoice_lines(*, products(sku)), supplier_payments(*)`)
      .eq("purchase_order_id", poId).order("invoice_date").returns<any[]>(),
  ]);
  const r = req.data;
  const gr = receipts.data ?? [];
  const inv = invoices.data ?? [];
  const ordered = (lines.data ?? []).reduce((s, l) => s + l.quantity, 0);
  const accepted = gr.flatMap((g) => g.goods_receipt_lines).reduce((s: number, l: any) => s + l.quantity_accepted, 0);
  const rejected = gr.flatMap((g) => g.goods_receipt_lines).reduce((s: number, l: any) => s + l.quantity_rejected, 0);
  const payable = inv.reduce((s, i) => s + Number(i.total_amount ?? 0), 0);
  const paid = inv.flatMap((i) => i.supplier_payments).reduce((s: number, p: any) => s + Number(p.amount), 0);
  const onHold = inv.filter((i) => i.status === "ON_HOLD");

  return (
    <div className="space-y-5">
      <Link href="/procurement" className="text-sm text-brand hover:underline">← Purchase orders</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold"><span className="font-mono">{po.po_number}</span> <Status s={po.status} /></h1>
          <p className="text-sm text-muted">{po.suppliers?.name} → {po.warehouses?.code} · ordered {date(po.order_date)} · expected {date(po.expected_date)} · buyer {who(po.buyer)}</p>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { l: "Ordered", v: `${num(ordered)} units`, n: thb(po.total_amount) + " incl. VAT" },
          { l: "Accepted into stock", v: `${num(accepted)} units`, n: `${gr.length} deliver${gr.length === 1 ? "y" : "ies"}` },
          { l: "Rejected at the dock", v: `${num(rejected)} units`, n: rejected ? "returned, never in stock" : "none", alert: rejected > 0 },
          { l: "Invoiced (approved)", v: thb(payable), n: onHold.length ? `${onHold.length} invoice(s) on hold` : `${inv.length} invoice(s)`, alert: onHold.length > 0 },
          { l: "Outstanding", v: thb(payable - paid), n: `paid ${thb(paid)}` },
        ].map((k) => (
          <div key={k.l} className="rounded-xl border border-line bg-surface p-4">
            <div className="text-sm text-muted">{k.l}</div>
            <div className={`mt-1 text-lg font-semibold tabular-nums ${k.alert ? "text-danger" : ""}`}>{k.v}</div>
            <div className="text-xs text-muted">{k.n}</div>
          </div>
        ))}
      </section>

      <ol className="space-y-3">
        <Step n={1} title="Requisition" doc={r && <Link href={`/procurement/requisitions/${r.requisition_id}`} className="font-mono text-brand hover:underline">{r.requisition_number}</Link>}>
          {r && <>
            <p>{r.source === "AUTO_REORDER" ? "Raised because stock fell below the reorder point" : "Emergency request"} by {who(r.requester)} on {date(r.request_date)}.
              Estimated {thb(r.estimated_amount)} excl. VAT, so it needed <b>{LEVEL_LABEL[r.approval_level]}</b>.</p>
            <p>{r.approval_level === "AUTO" ? "Under ฿50,000: approved automatically and converted the same day." : <>Approved by {who(r.approver)} on {date(r.decision_date)}.</>}</p>
          </>}
        </Step>

        <Step n={2} title="Purchase order" doc={<span className="font-mono">{po.po_number}</span>}>
          <p>Sent to {po.suppliers?.name} ({po.suppliers?.payment_terms_days}-day terms). Subtotal {thb(po.subtotal)} + VAT {thb(po.vat_amount)} = {thb(po.total_amount)}.</p>
          <Table head={["#", "Product", "Ordered", "Unit cost", "Amount", "Accepted so far"]}
            rows={(lines.data ?? []).map((l) => [l.line_no, prod(l.products), num(l.quantity), thb(l.unit_cost), thb(l.line_amount),
              <span key="a" className={l.received_quantity < l.quantity ? "text-danger" : ""}>{num(l.received_quantity)}</span>])} />
        </Step>

        <Step n={3} title={`Goods receipts (${gr.length})`} doc={null}>
          {gr.length === 0 && <p className="text-muted">Nothing delivered yet.</p>}
          {gr.map((g) => (
            <div key={g.goods_receipt_id} className="space-y-1">
              <p><span className="font-mono">{g.gr_number}</span> · delivery #{g.delivery_no} on {date(g.receipt_date)}
                {" "}<span className={g.receipt_date > po.expected_date ? "text-danger" : "text-ok"}>{g.receipt_date > po.expected_date ? "late" : "on time"}</span> · received by {who(g.receiver)}</p>
              <Table head={["Product", "Delivered", "Rejected", "Accepted", "Reason"]}
                rows={g.goods_receipt_lines.map((l: any) => [prod(l.products), num(l.quantity_received),
                  <span key="r" className={l.quantity_rejected ? "font-medium text-danger" : "text-muted"}>{num(l.quantity_rejected)}</span>,
                  num(l.quantity_accepted), l.rejection_reason ?? ""])} />
            </div>
          ))}
        </Step>

        <Step n={4} title={`Supplier invoices (${inv.length}) · three-way match`} doc={null}>
          <p className="text-muted">Each invoice is matched against its goods receipt (accepted qty) and the PO (price).</p>
          {inv.map((i) => (
            <div key={i.supplier_invoice_id} className="space-y-1">
              <p><span className="font-mono">{i.document_number}</span> (supplier ref {i.supplier_invoice_ref}) · {date(i.invoice_date)} · for {gr.find((g) => g.goods_receipt_id === i.goods_receipt_id)?.gr_number}
                {" "}<Status s={i.match_status} /> <Status s={i.status} /></p>
              <p>Billed {thb(i.billed_subtotal)} vs receipt value {thb(i.receipt_value)}
                {i.exception_type && <> · <b className="text-danger">{i.exception_type.replace(/_/g, " ").toLowerCase()} exception</b></>}
                {i.hold_reason && <> · on hold: “{i.hold_reason}”</>}
                {i.resolution && <> · resolved: {i.resolution.replace(/_/g, " ").toLowerCase()}{i.approver ? ` by ${who(i.approver)}` : ""}{i.approved_date ? ` on ${date(i.approved_date)}` : ""}</>}
                {i.price_variance != null && Number(i.price_variance) !== 0 && <> · price variance {thb(i.price_variance)} (GL 5200)</>}</p>
              <Table head={["Product", "Billed qty", "Accepted qty", "Billed price", "PO price", "Result"]}
                rows={i.supplier_invoice_lines.map((l: any) => [l.products?.sku, num(l.quantity_billed), num(l.quantity_accepted),
                  thb(l.unit_price_billed), thb(l.po_unit_cost),
                  <span key="m" className={l.match_result === "OK" ? "text-ok" : "font-medium text-danger"}>{l.match_result}</span>])} />
            </div>
          ))}
          {inv.length === 0 && <p className="text-muted">No invoice yet.</p>}
        </Step>

        <Step n={5} title="Payments" doc={null}>
          {inv.flatMap((i) => i.supplier_payments.map((p: any) => (
            <p key={p.supplier_payment_id}><span className="font-mono">{p.payment_number}</span> · {date(p.payment_date)} · {thb(p.amount)} by {p.method.toLowerCase()} for {i.document_number}</p>
          )))}
          {paid === 0 && <p className="text-muted">Nothing paid yet{onHold.length ? " (an invoice on hold can't be paid until it is resolved)" : ""}.</p>}
        </Step>
      </ol>

      <SqlBlock title={`trace ${po.po_number} by hand`} sql={poFlowSql(po.po_number)} note="One row per document, from requisition to payment. Run in Supabase → SQL Editor." />
    </div>
  );
}

const prod = (p: Prod) => <span><span className="font-mono text-xs">{p?.sku}</span> <span className="text-muted">{p?.name}</span></span>;

function Step({ n, title, doc, children }: { n: number; title: string; doc: ReactNode; children: ReactNode }) {
  return (
    <li className="rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-3 border-b border-line px-5 py-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">{n}</span>
        <h2 className="font-semibold">{title}</h2>
        {doc && <span className="text-sm">{doc}</span>}
      </div>
      <div className="space-y-3 px-5 py-3 text-sm">{children}</div>
    </li>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-sm">
        <thead className="bg-background/50 text-left text-xs text-muted"><tr>{head.map((h) => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="px-3 py-1.5 tabular-nums">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
