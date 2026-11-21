import "server-only";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cursorPage } from "@/lib/cursor";
import { getCurrentEmployee } from "@/lib/dal";
import { id, isoDate, one, oneOf, searchTerm } from "@/lib/filters";
import { date, thb } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

/** Page guard: same rule as RLS on every procurement table (can_view_procurement()). */
export async function requireProcurement() {
  const me = await getCurrentEmployee();
  const supabase = await createClient();
  const { data } = await supabase.rpc("can_view_procurement");
  if (data !== true) redirect("/?denied=procurement.view");
  return { me, supabase };
}

export const PO_STATUSES = ["OPEN", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED_SHORT"] as const;
export type PoFilters = { q: string; status: string; supplier: number | null; warehouse: number | null; from: string; to: string };

export function parsePoFilters(sp: Record<string, string | string[] | undefined>): PoFilters {
  return { q: searchTerm(one(sp, "q")), status: oneOf(one(sp, "status"), PO_STATUSES), supplier: id(one(sp, "supplier")),
    warehouse: id(one(sp, "warehouse")), from: isoDate(one(sp, "from")), to: isoDate(one(sp, "to")) };
}

type Po = {
  purchase_order_id: number; po_number: string; order_date: string; expected_date: string; status: string; total_amount: number;
  suppliers: { name: string } | null; warehouses: { code: string } | null;
  purchase_requisitions: { requisition_number: string; approval_level: string } | null;
};

type Client = Awaited<ReturnType<typeof createClient>>;

function filtered(s: Client, f: PoFilters, columns: string, count?: "exact") {
  const byNumber = /^(po|\d)/i.test(f.q);
  const supplier = f.q && !byNumber ? "suppliers!inner(name)" : "suppliers(name)";
  let q = s.from("purchase_orders").select(`${columns}, ${supplier}`, count ? { count, head: true } : undefined);
  if (f.status) q = q.eq("status", f.status);
  if (f.supplier) q = q.eq("supplier_id", f.supplier);
  if (f.warehouse) q = q.eq("warehouse_id", f.warehouse);
  if (f.from) q = q.gte("order_date", f.from);
  if (f.to) q = q.lte("order_date", f.to);
  if (f.q) q = byNumber ? q.ilike("po_number", `%${f.q}%`) : q.ilike("suppliers.name", `%${f.q}%`);
  return q;
}

export async function poPage(f: PoFilters, after?: string) {
  const s = await createClient();
  return cursorPage<Po>({
    search: { after }, size: 30, keys: ["order_date", "purchase_order_id"], descending: true,
    query: () => filtered(s, f, "purchase_order_id, po_number, order_date, expected_date, status, total_amount, warehouses(code), purchase_requisitions(requisition_number, approval_level)"),
    keyOf: (o) => [o.order_date, o.purchase_order_id],
  });
}

export async function poCount(f: PoFilters) {
  const s = await createClient();
  const { count } = await filtered(s, f, "purchase_order_id", "exact");
  return count ?? 0;
}

export const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-brand/10 text-brand", PARTIALLY_RECEIVED: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  RECEIVED: "bg-ok/10 text-ok", CLOSED_SHORT: "bg-background text-muted",
  PENDING_APPROVAL: "bg-amber-500/15 text-amber-700 dark:text-amber-400", CONVERTED: "bg-ok/10 text-ok", REJECTED: "bg-danger/10 text-danger",
  ON_HOLD: "bg-danger/10 text-danger", PAID: "bg-ok/10 text-ok", MATCHED: "bg-ok/10 text-ok",
  WITHIN_TOLERANCE: "bg-brand/10 text-brand", EXCEPTION: "bg-danger/10 text-danger",
};
export function Status({ s }: { s: string | null }) {
  if (!s) return null;
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s] ?? "bg-background text-muted"}`}>{s.replace(/_/g, " ").toLowerCase()}</span>;
}
export const LEVEL_LABEL: Record<string, string> = { AUTO: "auto (< ฿50k)", PURCHASING_MANAGER: "Purchasing Manager", MANAGING_DIRECTOR: "Managing Director" };

export function PoRows({ rows }: { rows: Po[] }) {
  return rows.map((o) => (
    <tr key={o.purchase_order_id} className="border-t border-line">
      <td className="px-5 py-2"><Link href={`/procurement/${o.purchase_order_id}`} className="font-mono text-xs font-medium text-brand hover:underline">{o.po_number}</Link></td>
      <td className="whitespace-nowrap px-5 py-2">{date(o.order_date)}</td>
      <td className="px-5 py-2">{o.suppliers?.name}</td>
      <td className="px-5 py-2">{o.warehouses?.code}</td>
      <td className="px-5 py-2"><Status s={o.status} /></td>
      <td className="px-5 py-2 text-xs text-muted">{o.purchase_requisitions ? LEVEL_LABEL[o.purchase_requisitions.approval_level] : ""}</td>
      <td className="px-5 py-2 text-right tabular-nums">{thb(o.total_amount)}</td>
    </tr>
  ));
}

/** The PO made from a requisition (PostgREST returns an object, since requisition_id is unique on purchase_orders). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const poOf = (r: any): { purchase_order_id: number; po_number: string } | null =>
  (Array.isArray(r.purchase_orders) ? r.purchase_orders[0] : r.purchase_orders) ?? null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ReqSummary({ r }: { r: any }) {
  const l = r.purchase_requisition_lines?.[0];
  return (
    <div className="text-sm">
      <div className="font-medium">
        <Link href={`/procurement/requisitions/${r.requisition_id}`} className="font-mono text-brand hover:underline">{r.requisition_number}</Link>
        {" "}· {thb(r.estimated_amount)} <Status s={r.status} /> <span className="text-xs text-muted">{LEVEL_LABEL[r.approval_level]}</span>
      </div>
      <div className="text-muted">
        {l && <>{l.quantity} × <span className="font-mono text-xs">{l.products?.sku}</span> {l.products?.name}{r.purchase_requisition_lines.length > 1 ? ` + ${r.purchase_requisition_lines.length - 1} more` : ""} · </>}
        {r.suppliers?.name} → {r.warehouses?.code} · by {r.requester?.first_name} {r.requester?.last_name} on {date(r.request_date)}
        {r.decision_date && r.approver && <> · decided by {r.approver.first_name} {r.approver.last_name}</>}
      </div>
    </div>
  );
}
