import "server-only";
import { cursorPage } from "@/lib/cursor";
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

/** One page (newest first). sales_order_id breaks ties between orders on the same day. */
export async function salesOrdersPage(after?: string) {
  const supabase = await createClient();
  return cursorPage<Order>({
    search: { after }, size: 30, keys: ["order_date", "sales_order_id"], descending: true,
    query: () => supabase.from("sales_orders")
      .select("sales_order_id, order_number, order_date, status, total_amount, customers(name), warehouses(code)"),
    keyOf: (o) => [o.order_date, o.sales_order_id],
  });
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
