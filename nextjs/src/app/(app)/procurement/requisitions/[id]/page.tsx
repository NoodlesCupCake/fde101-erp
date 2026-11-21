import Link from "next/link";
import { notFound } from "next/navigation";
import { id as toId } from "@/lib/filters";
import { date, num, thb } from "@/lib/format";
import { decideRequisition } from "../../actions";
import { LEVEL_LABEL, poOf, requireProcurement, Status } from "../../data";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function Requisition({ params, searchParams }: PageProps<"/procurement/requisitions/[id]">) {
  const { supabase } = await requireProcurement();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const rid = toId(id);
  if (!rid) notFound();
  const person = "employee_code, first_name, last_name, job_title";
  const { data: r } = await supabase.from("purchase_requisitions")
    .select(`*, warehouses(code, name), suppliers(name), requester:employees!purchase_requisitions_requested_by_fkey(${person}), approver:employees!purchase_requisitions_approver_id_fkey(${person}), purchase_requisition_lines(line_no, quantity, estimated_unit_cost, products(product_id, sku, name, uom)), purchase_orders(purchase_order_id, po_number)`)
    .eq("requisition_id", rid).maybeSingle<any>();
  if (!r) notFound();
  const { data: can } = await supabase.rpc("can_decide_requisition", { p_requisition_id: rid });
  const po = poOf(r);
  const pending = r.status === "PENDING_APPROVAL";

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/procurement/requisitions" className="text-sm text-brand hover:underline">← Requisitions</Link>
      {sp.ok === "created" && (
        <p role="status" className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">
          Requisition created. {po ? <>Under ฿50,000, so it was approved automatically and became <Link className="font-mono underline" href={`/procurement/${po.purchase_order_id}`}>{po.po_number}</Link>.</>
            : <>It needs the <b>{LEVEL_LABEL[r.approval_level]}</b>. It is in their queue now.</>}
        </p>
      )}
      {typeof sp.ok === "string" && sp.ok !== "created" && <p role="status" className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">{sp.ok}</p>}
      {typeof sp.error === "string" && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{sp.error}</p>}

      <div>
        <h1 className="text-xl font-semibold"><span className="font-mono">{r.requisition_number}</span> <Status s={r.status} /></h1>
        <p className="text-sm text-muted">{r.source === "AUTO_REORDER" ? "Below reorder point" : "Emergency"} · {r.warehouses?.code} · supplier {r.suppliers?.name} ·
          by {r.requester?.first_name} {r.requester?.last_name} ({r.requester?.employee_code}) on {date(r.request_date)}</p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5 text-sm">
        <table className="w-full">
          <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-medium">Product</th><th className="py-1 text-right font-medium">Qty</th><th className="py-1 text-right font-medium">Unit cost</th><th className="py-1 text-right font-medium">Amount</th></tr></thead>
          <tbody>
            {r.purchase_requisition_lines.map((l: any) => (
              <tr key={l.line_no} className="border-t border-line">
                <td className="py-1.5"><Link href={`/stock/${l.products.product_id}?warehouse=${r.warehouse_id}`} className="text-brand hover:underline">{l.products.name}</Link> <span className="font-mono text-xs text-muted">{l.products.sku}</span></td>
                <td className="py-1.5 text-right tabular-nums">{num(l.quantity)} {l.products.uom}</td>
                <td className="py-1.5 text-right tabular-nums">{thb(l.estimated_unit_cost)}</td>
                <td className="py-1.5 text-right tabular-nums">{thb(l.quantity * l.estimated_unit_cost)}</td>
              </tr>
            ))}
            <tr className="border-t border-line font-semibold"><td className="py-1.5" colSpan={3}>Estimated, excl. VAT</td><td className="py-1.5 text-right tabular-nums">{thb(r.estimated_amount)}</td></tr>
          </tbody>
        </table>
        <p className="mt-3">Approval needed: <b>{LEVEL_LABEL[r.approval_level]}</b>
          {r.approver && <> · {pending ? "routed to" : "decided by"} {r.approver.first_name} {r.approver.last_name} ({r.approver.job_title})</>}
          {r.decision_date && <> on {date(r.decision_date)}</>}</p>
        {r.rejection_reason && <p className="text-danger">Rejected: “{r.rejection_reason}”</p>}
        {po && <p className="mt-1">Purchase order: <Link href={`/procurement/${po.purchase_order_id}`} className="font-mono text-brand hover:underline">{po.po_number} →</Link></p>}
      </div>

      {pending && (can === true ? (
        <form action={decideRequisition} className="flex flex-wrap items-start gap-2">
          <input type="hidden" name="requisition_id" value={rid} /><input type="hidden" name="back" value="detail" />
          <input name="reason" placeholder="Reason (required to reject)" maxLength={300} className="h-9 w-64 rounded-md border border-line bg-surface px-3 text-sm" />
          <button name="decision" value="approve" className="h-9 rounded-md bg-ok px-3 text-sm font-medium text-white hover:opacity-90">Approve → create PO</button>
          <button name="decision" value="reject" className="h-9 rounded-md border border-danger/40 px-3 text-sm text-danger hover:bg-danger/5">Reject</button>
        </form>
      ) : <p className="text-sm text-muted">Waiting for the {LEVEL_LABEL[r.approval_level]}. You can&apos;t decide this one.</p>)}
    </div>
  );
}
