import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { InfiniteRows } from "@/components/infinite-rows";
import { getCurrentEmployee } from "@/lib/dal";
import { num } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { loadSalesOrders } from "./actions";
import { parseSalesFilters, SalesOrderRows, salesOrdersCount, salesOrdersPage, STATUSES } from "./data";

export default async function SalesOrders({ searchParams }: PageProps<"/sales-orders">) {
  const me = await getCurrentEmployee();
  const sp = await searchParams;
  const f = parseSalesFilters(sp);
  const supabase = await createClient();
  const [page, total, warehouses, customers, canCreate] = await Promise.all([
    salesOrdersPage(f),
    salesOrdersCount(f),
    supabase.from("warehouses").select("warehouse_id, code, name").order("code"),
    supabase.from("customers").select("customer_id, name, sales_rep_id, rep:employees(employee_id, first_name, last_name, employee_code)").order("name"),
    supabase.rpc("can_create_sales_order"),
  ]);
  // Rep filter = the reps of the customers this user can see (RLS): one for a rep, the whole team for the manager.
  type Rep = { employee_id: number; first_name: string; last_name: string; employee_code: string };
  const reps = [...new Map((customers.data ?? []).map((c) => c.rep as unknown as Rep).filter(Boolean).map((r) => [r.employee_id, r])).values()]
    .sort((a, b) => a.first_name.localeCompare(b.first_name));
  const raw = { q: f.q, status: f.status, customer: f.customer ? String(f.customer) : "", rep: f.rep ? String(f.rep) : "",
    warehouse: f.warehouse ? String(f.warehouse) : "", from: f.from, to: f.to };
  const scope = reps.length <= 1 ? "your own customers' orders" : `${reps.length} sales reps' orders`;

  return (
    <div className="space-y-3">
      {typeof sp.ok === "string" && <p role="status" className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">{sp.ok}</p>}
      <div className="rounded-xl border border-line bg-surface">
        <div className="space-y-3 border-b border-line px-5 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="font-semibold">Sales orders <span className="font-normal text-muted">({num(total)} found)</span></h1>
              <p className="text-xs text-muted">You see {scope} ({me.employee_code}). Filtered and paged in the database; the filters are in the URL, so you can share this view.</p>
            </div>
            {canCreate.data === true && <Link href="/sales-orders/new" className="h-9 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90">+ New order</Link>}
          </div>
          <FilterBar fields={[
            { name: "q", type: "search", placeholder: "Order no. or customer…" },
            { name: "status", type: "select", label: "Status", options: STATUSES.map((s) => ({ value: s, label: s.toLowerCase() })) },
            { name: "customer", type: "select", label: "Customer", options: (customers.data ?? []).map((c) => ({ value: String(c.customer_id), label: c.name })) },
            ...(reps.length > 1 ? [{ name: "rep", type: "select" as const, label: "Sales rep", options: reps.map((r) => ({ value: String(r.employee_id), label: `${r.first_name} ${r.last_name}` })) }] : []),
            { name: "warehouse", type: "select", label: "Warehouse", options: (warehouses.data ?? []).map((w) => ({ value: String(w.warehouse_id), label: `${w.code} · ${w.name}` })) },
            { name: "from", type: "date", label: "From" },
            { name: "to", type: "date", label: "To" },
          ]} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr><th className="px-5 py-2 font-medium">Order</th><th className="px-5 py-2 font-medium">Date</th><th className="px-5 py-2 font-medium">Customer</th>
                <th className="px-5 py-2 font-medium">Sales rep</th><th className="px-5 py-2 font-medium">Warehouse</th><th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              <SalesOrderRows rows={page.rows} />
              {page.rows.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-muted">No orders match these filters.</td></tr>}
              <InfiniteRows key={JSON.stringify(raw)} next={page.next} load={loadSalesOrders.bind(null, raw)} colSpan={7} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
