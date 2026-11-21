/** Plain SQL behind the procurement pages, to paste into the Supabase SQL Editor and check by hand. */
const q = (s: string) => s.replace(/^\n/, "").replace(/\n\s*$/, "");
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Every document of one PO, in order: requisition → PO → receipts → invoices → payments. */
export function poFlowSql(poNumber: string) {
  return q(`
-- The whole flow of ${poNumber}, one row per document, oldest first
with po as (select * from purchase_orders where po_number = ${lit(poNumber)})
select 1 as step, 'REQUISITION' as doc, r.requisition_number as number, r.request_date as date,
       r.estimated_amount as amount, r.approval_level || ' · ' || r.status
         || coalesce(' · approver ' || a.employee_code || ' ' || a.job_title, '') as detail
from po join purchase_requisitions r using (requisition_id) left join employees a on a.employee_id = r.approver_id
union all
select 2, 'PURCHASE ORDER', po.po_number, po.order_date, po.subtotal,
       po.status || ' · expected ' || po.expected_date || ' · ' || (select sum(quantity) from purchase_order_lines l
         where l.purchase_order_id = po.purchase_order_id) || ' units ordered'
from po
union all
select 3, 'GOODS RECEIPT #' || gr.delivery_no, gr.gr_number, gr.receipt_date,
       sum(l.quantity_accepted * l.unit_cost),
       sum(l.quantity_received) || ' delivered, ' || sum(l.quantity_rejected) || ' rejected, ' || sum(l.quantity_accepted) || ' accepted'
         || case when gr.receipt_date > po.expected_date then ' · LATE' else ' · on time' end
from po join goods_receipts gr using (purchase_order_id) join goods_receipt_lines l using (goods_receipt_id)
group by gr.goods_receipt_id, gr.delivery_no, gr.gr_number, gr.receipt_date, po.expected_date
union all
select 4, 'SUPPLIER INVOICE', si.document_number || ' (' || si.supplier_invoice_ref || ')', si.invoice_date,
       si.billed_subtotal,
       si.match_status || coalesce(' ' || si.exception_type, '') || ' vs receipt ' || si.receipt_value
         || ' · ' || si.status || coalesce(' · ' || si.resolution, '') || coalesce(' · hold: ' || si.hold_reason, '')
from po join supplier_invoices si using (purchase_order_id)
union all
select 5, 'PAYMENT', p.payment_number, p.payment_date, p.amount, p.method || ' for ' || si.document_number
from po join supplier_invoices si using (purchase_order_id) join supplier_payments p using (supplier_invoice_id)
order by step, date, number;`);
}

export const holdSql = q(`
-- Supplier invoices on hold: three-way match failed (PO price/qty vs goods receipt vs invoice) and not resolved yet
select si.document_number, si.supplier_invoice_ref, s.name as supplier, po.po_number, gr.gr_number,
       si.invoice_date, si.exception_type, si.hold_reason,
       si.billed_subtotal, si.receipt_value, si.billed_subtotal - si.receipt_value as difference
from supplier_invoices si
join suppliers s using (supplier_id)
join purchase_orders po using (purchase_order_id)
join goods_receipts gr using (goods_receipt_id)
where si.status = 'ON_HOLD'
order by si.invoice_date;

-- The lines that do not match
select si.document_number, l.line_no, p.sku,
       l.quantity_billed, l.quantity_accepted, l.unit_price_billed, l.po_unit_cost, l.match_result
from supplier_invoice_lines l
join supplier_invoices si using (supplier_invoice_id)
join products p using (product_id)
where si.status = 'ON_HOLD' and l.match_result <> 'OK'
order by si.document_number, l.line_no;`);

export const scorecardSql = q(`
-- Supplier scorecard: on-time (receipt_date ≤ PO expected_date, per delivery), rejection rate, invoice exceptions
with g as (
  select o.supplier_id, count(*) as receipts, count(*) filter (where gr.receipt_date <= o.expected_date) as on_time
  from goods_receipts gr join purchase_orders o using (purchase_order_id) group by 1
), u as (
  select o.supplier_id, sum(l.quantity_received) as recv, sum(l.quantity_rejected) as rej
  from goods_receipt_lines l join goods_receipts gr using (goods_receipt_id) join purchase_orders o using (purchase_order_id) group by 1
), i as (
  select supplier_id, count(*) as n, count(*) filter (where match_status = 'EXCEPTION') as exc from supplier_invoices group by 1
)
select s.supplier_code, s.name,
       g.receipts, round(100.0 * g.on_time / nullif(g.receipts, 0), 1) as on_time_pct,
       u.recv as units_received, u.rej as units_rejected, round(100.0 * u.rej / nullif(u.recv, 0), 2) as rejection_pct,
       i.n as invoices, i.exc as exceptions, round(100.0 * i.exc / nullif(i.n, 0), 1) as exception_pct
from suppliers s
left join g using (supplier_id) left join u using (supplier_id) left join i using (supplier_id)
order by on_time_pct nulls last;`);

export function approvalCheckSql() {
  return q(`
-- Check: no purchase order exists whose requisition was approved below the level its amount needs
select r.requisition_number, r.estimated_amount, r.approval_level, a.employee_code, a.job_title, po.po_number
from purchase_orders po
join purchase_requisitions r using (requisition_id)
left join employees a on a.employee_id = r.approver_id
where (r.estimated_amount > 300000 and a.job_title is distinct from 'Managing Director')
   or (r.estimated_amount >= 50000 and coalesce(a.job_title, '') not in ('Purchasing Manager', 'Managing Director'));
-- expected: 0 rows

-- The trigger that enforces it on every new PO
select tgname, tgenabled from pg_trigger where tgrelid = 'purchase_orders'::regclass and not tgisinternal;`);
}
