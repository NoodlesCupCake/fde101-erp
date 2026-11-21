import "server-only";
import { cursorPage } from "@/lib/cursor";
import { id, isoDate, one, oneOf, searchTerm } from "@/lib/filters";
import { date, thb } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type Order = {
  sales_order_id: number;
  order_number: string;
  order_date: string;
  status: string;
  total_amount: number;
  customers: { name: string } | null;
  warehouses: { code: string } | null;
};

const STATUSES = ["OPEN", "INVOICED", "CANCELLED"] as const;
export type SalesFilters = { q: string; status: string; warehouse: number | null; from: string; to: string };

export function parseSalesFilters(sp: Record<string, string | string[] | undefined>): SalesFilters {
  return { q: searchTerm(one(sp, "q")), status: oneOf(one(sp, "status"), STATUSES), warehouse: id(one(sp, "warehouse")),
    from: isoDate(one(sp, "from")), to: isoDate(one(sp, "to")) };
}

type Client = Awaited<ReturnType<typeof createClient>>;

/** Same filters for the page query and the count. "SO26-…" or digits search the order number, anything else the customer. */
function filtered(s: Client, f: SalesFilters, columns: string, count?: "exact") {
  const byOrderNo = /^(so|\d)/i.test(f.q);
  const customer = f.q && !byOrderNo ? "customers!inner(name)" : "customers(name)";
  let q = s.from("sales_orders").select(`${columns}, ${customer}`, count ? { count, head: true } : undefined);
  if (f.status) q = q.eq("status", f.status);
  if (f.warehouse) q = q.eq("warehouse_id", f.warehouse);
  if (f.from) q = q.gte("order_date", f.from);
  if (f.to) q = q.lte("order_date", f.to);
  if (f.q) q = byOrderNo ? q.ilike("order_number", `%${f.q}%`) : q.ilike("customers.name", `%${f.q}%`);
  return q;
}

/** One page (newest first). sales_order_id breaks ties between orders on the same day. */
export async function salesOrdersPage(f: SalesFilters, after?: string) {
  const s = await createClient();
  return cursorPage<Order>({
    search: { after }, size: 30, keys: ["order_date", "sales_order_id"], descending: true,
    query: () => filtered(s, f, "sales_order_id, order_number, order_date, status, total_amount, warehouses(code)"),
    keyOf: (o) => [o.order_date, o.sales_order_id],
  });
}

export async function salesOrdersCount(f: SalesFilters) {
  const s = await createClient();
  const any = f.q || f.status || f.warehouse || f.from || f.to;
  const { count } = any
    ? await filtered(s, f, "sales_order_id", "exact")
    : await s.from("sales_orders").select("*", { count: "estimated", head: true });
  return { count, exact: !!any };
}

export function SalesOrderRows({ rows }: { rows: Order[] }) {
  return rows.map((o) => (
    <tr key={o.sales_order_id} className="border-t border-line">
      <td className="px-5 py-2 font-mono text-xs">{o.order_number}</td>
      <td className="whitespace-nowrap px-5 py-2">{date(o.order_date)}</td>
      <td className="px-5 py-2">{o.customers?.name}</td>
      <td className="px-5 py-2">{o.warehouses?.code}</td>
      <td className="px-5 py-2">{o.status}</td>
      <td className="px-5 py-2 text-right tabular-nums">{thb(o.total_amount)}</td>
    </tr>
  ));
}
