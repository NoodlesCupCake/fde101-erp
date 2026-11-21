import Link from "next/link";
import { Flash } from "@/app/(app)/leave/shared";
import { SqlBlock } from "@/components/sql-block";
import { decideRequisition } from "../actions";
import { LEVEL_LABEL, poOf, ReqSummary, requireProcurement } from "../data";
import { approvalCheckSql } from "../sql";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SELECT = "requisition_id, requisition_number, source, request_date, estimated_amount, approval_level, status, decision_date, rejection_reason, warehouses(code), suppliers(name), requester:employees!purchase_requisitions_requested_by_fkey(employee_code, first_name, last_name), approver:employees!purchase_requisitions_approver_id_fkey(employee_code, first_name, last_name, job_title), purchase_requisition_lines(quantity, products(sku, name)), purchase_orders(purchase_order_id, po_number)";

/**
 * The approval queue (Workshop 1.5 pattern): every PENDING_APPROVAL requisition, with buttons only where
 * can_decide_requisition() says yes. decide_requisition() checks again, and a trigger guards purchase_orders.
 */
export default async function Requisitions({ searchParams }: PageProps<"/procurement/requisitions">) {
  const { me, supabase } = await requireProcurement();
  const sp = await searchParams;
  const [pending, recent, authority] = await Promise.all([
    supabase.from("purchase_requisitions").select(SELECT).eq("status", "PENDING_APPROVAL").order("estimated_amount", { ascending: false }).returns<any[]>(),
    supabase.from("purchase_requisitions").select(SELECT).neq("status", "PENDING_APPROVAL").order("requisition_id", { ascending: false }).limit(25).returns<any[]>(),
    supabase.rpc("procurement_authority", { p_employee_id: me.employee_id }),
  ]);
  const rows = pending.data ?? [];
  const can = await Promise.all(rows.map((r) => supabase.rpc("can_decide_requisition", { p_requisition_id: r.requisition_id }).then((x) => x.data === true)));
  const mine = authority.data === 2 ? "You are the Managing Director: you approve everything over ฿50,000."
    : authority.data === 1 ? "You are the Purchasing Manager: you approve ฿50,000–300,000. Over ฿300,000 goes to the Managing Director."
    : "You don't approve requisitions. The Purchasing Manager approves ฿50,000–300,000 and the Managing Director over ฿300,000.";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Purchase requisitions</h1>
          <p className="text-sm text-muted">Under ฿50,000 becomes a PO automatically. {mine}</p>
        </div>
        <Link href="/stock?view=reorder#list" className="h-9 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90">+ From a low-stock item</Link>
      </div>
      <Flash sp={sp} />

      <section className="rounded-xl border border-line bg-surface">
        <h2 className="border-b border-line px-5 py-3 font-semibold">Waiting for approval ({rows.length})</h2>
        <ul className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.requisition_id} className="grid gap-3 px-5 py-3 md:grid-cols-[1fr_auto]">
              <ReqSummary r={r} />
              {can[i] ? (
                <form action={decideRequisition} className="flex flex-wrap items-start gap-2">
                  <input type="hidden" name="requisition_id" value={r.requisition_id} />
                  <input name="reason" placeholder="Reason (required to reject)" maxLength={300} className="h-9 w-52 rounded-md border border-line bg-surface px-3 text-sm" />
                  <button name="decision" value="approve" className="h-9 rounded-md bg-ok px-3 text-sm font-medium text-white hover:opacity-90">Approve → PO</button>
                  <button name="decision" value="reject" className="h-9 rounded-md border border-danger/40 px-3 text-sm text-danger hover:bg-danger/5">Reject</button>
                </form>
              ) : (
                <span className="self-center text-xs text-muted">Needs the {LEVEL_LABEL[r.approval_level]}</span>
              )}
            </li>
          ))}
          {rows.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">Nothing waiting.</li>}
        </ul>
      </section>

      <section className="rounded-xl border border-line bg-surface">
        <h2 className="border-b border-line px-5 py-3 font-semibold">Latest decided</h2>
        <ul className="divide-y divide-line">
          {(recent.data ?? []).map((r) => (
            <li key={r.requisition_id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
              <ReqSummary r={r} />
              {poOf(r) ? (
                <Link href={`/procurement/${poOf(r)!.purchase_order_id}`} className="font-mono text-xs text-brand hover:underline">{poOf(r)!.po_number} →</Link>
              ) : r.rejection_reason ? <span className="text-xs text-danger">“{r.rejection_reason}”</span> : null}
            </li>
          ))}
        </ul>
      </section>
      <SqlBlock title="check: no PO was approved below its level" sql={approvalCheckSql()} />
    </div>
  );
}
