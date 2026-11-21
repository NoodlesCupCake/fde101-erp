import { Pager } from "@/components/pager";
import { cursorPage } from "@/lib/cursor";
import { getCurrentEmployee } from "@/lib/dal";
import { date, num, thb } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Order = {
  sales_order_id: number;
  order_number: string;
  order_date: string;
  status: string;
  total_amount: number;
  customers: { name: string } | null;
  warehouses: { code: string } | null;
};

export default async function SalesOrders({ searchParams }: PageProps<"/sales-orders">) {
  await getCurrentEmployee();
  const sp = await searchParams;
  const supabase = await createClient();

  const [page, total] = await Promise.all([
    // newest first; sales_order_id breaks ties between orders on the same day
    cursorPage<Order>({
      search: sp, size: 25, keys: ["order_date", "sales_order_id"], descending: true,
      query: () => supabase.from("sales_orders")
        .select("sales_order_id, order_number, order_date, status, total_amount, customers(name), warehouses(code)"),
      keyOf: (o) => [o.order_date, o.sales_order_id],
    }),
    supabase.from("sales_orders").select("*", { count: "estimated", head: true }),
  ]);

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h1 className="font-semibold">Sales orders <span className="font-normal text-muted">(~{num(total.count)})</span></h1>
        <Pager base="/sales-orders" prev={page.prev} next={page.next} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr><th className="px-5 py-2 font-medium">Order</th><th className="px-5 py-2 font-medium">Date</th><th className="px-5 py-2 font-medium">Customer</th><th className="px-5 py-2 font-medium">Warehouse</th><th className="px-5 py-2 font-medium">Status</th><th className="px-5 py-2 text-right font-medium">Total</th></tr>
          </thead>
          <tbody>
            {page.rows.map((o) => (
              <tr key={o.sales_order_id} className="border-t border-line">
                <td className="px-5 py-2 font-mono text-xs">{o.order_number}</td>
                <td className="whitespace-nowrap px-5 py-2">{date(o.order_date)}</td>
                <td className="px-5 py-2">{o.customers?.name}</td>
                <td className="px-5 py-2">{o.warehouses?.code}</td>
                <td className="px-5 py-2">{o.status}</td>
                <td className="px-5 py-2 text-right tabular-nums">{thb(o.total_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end border-t border-line px-5 py-3">
        <Pager base="/sales-orders" prev={page.prev} next={page.next} />
      </div>
    </div>
  );
}
