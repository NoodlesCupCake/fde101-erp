import { FilterBar } from "@/components/filter-bar";
import { InfiniteRows } from "@/components/infinite-rows";
import { getCurrentEmployee } from "@/lib/dal";
import { num } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { loadSalesOrders } from "./actions";
import { parseSalesFilters, SalesOrderRows, salesOrdersCount, salesOrdersPage } from "./data";

export default async function SalesOrders({ searchParams }: PageProps<"/sales-orders">) {
  await getCurrentEmployee();
  const f = parseSalesFilters(await searchParams);
  const supabase = await createClient();
  const [page, total, warehouses] = await Promise.all([
    salesOrdersPage(f),
    salesOrdersCount(f),
    supabase.from("warehouses").select("warehouse_id, code, name").order("code"),
  ]);
  const raw = { q: f.q, status: f.status, warehouse: f.warehouse ? String(f.warehouse) : "", from: f.from, to: f.to };

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="space-y-3 border-b border-line px-5 py-3">
        <h1 className="font-semibold">
          Sales orders <span className="font-normal text-muted">({total.exact ? "" : "~"}{num(total.count)}{total.exact ? " found" : ""})</span>
        </h1>
        <FilterBar fields={[
          { name: "q", type: "search", placeholder: "Order no. or customer…" },
          { name: "status", type: "select", label: "Status", options: ["OPEN", "INVOICED", "CANCELLED"].map((s) => ({ value: s, label: s })) },
          { name: "warehouse", type: "select", label: "Warehouse", options: (warehouses.data ?? []).map((w) => ({ value: String(w.warehouse_id), label: `${w.code} · ${w.name}` })) },
          { name: "from", type: "date", label: "From" },
          { name: "to", type: "date", label: "To" },
        ]} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr><th className="px-5 py-2 font-medium">Order</th><th className="px-5 py-2 font-medium">Date</th><th className="px-5 py-2 font-medium">Customer</th><th className="px-5 py-2 font-medium">Warehouse</th><th className="px-5 py-2 font-medium">Status</th><th className="px-5 py-2 text-right font-medium">Total</th></tr>
          </thead>
          <tbody>
            <SalesOrderRows rows={page.rows} />
            {page.rows.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-muted">No orders match these filters.</td></tr>}
            <InfiniteRows key={JSON.stringify(raw)} next={page.next} load={loadSalesOrders.bind(null, raw)} colSpan={6} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
