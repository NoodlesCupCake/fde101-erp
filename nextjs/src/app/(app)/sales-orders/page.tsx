import { InfiniteRows } from "@/components/infinite-rows";
import { getCurrentEmployee } from "@/lib/dal";
import { num } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { loadSalesOrders } from "./actions";
import { SalesOrderRows, salesOrdersPage } from "./data";

export default async function SalesOrders() {
  await getCurrentEmployee();
  const supabase = await createClient();
  const [page, total] = await Promise.all([
    salesOrdersPage(),
    supabase.from("sales_orders").select("*", { count: "estimated", head: true }),
  ]);

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-5 py-3">
        <h1 className="font-semibold">Sales orders <span className="font-normal text-muted">(~{num(total.count)})</span></h1>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-left text-muted">
            <tr><th className="px-5 py-2 font-medium">Order</th><th className="px-5 py-2 font-medium">Date</th><th className="px-5 py-2 font-medium">Customer</th><th className="px-5 py-2 font-medium">Warehouse</th><th className="px-5 py-2 font-medium">Status</th><th className="px-5 py-2 text-right font-medium">Total</th></tr>
          </thead>
          <tbody>
            <SalesOrderRows rows={page.rows} />
            <InfiniteRows next={page.next} load={loadSalesOrders} colSpan={6} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
