import Link from "next/link";
import { getCurrentEmployee } from "@/lib/dal";
import { date, num, thb } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type RecentOrder = {
  sales_order_id: number;
  order_number: string;
  order_date: string;
  status: string;
  total_amount: number;
  customers: { name: string } | null;
};

export default async function Dashboard() {
  const me = await getCurrentEmployee();
  const supabase = await createClient();
  const count = (table: string, filter?: [string, string]) => {
    let q = supabase.from(table).select("*", { count: "exact", head: true });
    if (filter) q = q.eq(filter[0], filter[1]);
    return q.then((r) => r.count);
  };

  // Every query runs as the signed-in user, so RLS (active employees only) applies in the database too.
  const [customers, orders, openInvoices, products, recent] = await Promise.all([
    count("customers"),
    count("sales_orders"),
    count("sales_invoices", ["status", "OPEN"]),
    count("products", ["is_active", "true"]),
    supabase
      .from("sales_orders")
      .select("sales_order_id, order_number, order_date, status, total_amount, customers(name)")
      .order("order_date", { ascending: false })
      .order("sales_order_id", { ascending: false })
      .limit(8)
      .returns<RecentOrder[]>(),
  ]);

  const kpis = [
    { label: "Customers", value: num(customers) },
    { label: "Sales orders", value: num(orders) },
    { label: "Open invoices", value: num(openInvoices) },
    { label: "Active products", value: num(products) },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-surface p-5">
        <h1 className="text-xl font-semibold">Welcome, {me.first_name}</h1>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">Employee code</dt><dd className="font-medium">{me.employee_code}</dd></div>
          <div><dt className="text-muted">Department</dt><dd className="font-medium">{me.department}</dd></div>
          <div><dt className="text-muted">Job title</dt><dd className="font-medium">{me.job_title}</dd></div>
          <div><dt className="text-muted">Hired</dt><dd className="font-medium">{date(me.hire_date)}</dd></div>
        </dl>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-line bg-surface p-4">
            <div className="text-sm text-muted">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{k.value}</div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold">Latest sales orders</h2>
          <Link href="/sales-orders" className="text-sm text-brand hover:underline">View all</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr><th className="px-5 py-2 font-medium">Order</th><th className="px-5 py-2 font-medium">Date</th><th className="px-5 py-2 font-medium">Customer</th><th className="px-5 py-2 font-medium">Status</th><th className="px-5 py-2 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {(recent.data ?? []).map((o) => (
                <tr key={o.sales_order_id} className="border-t border-line">
                  <td className="px-5 py-2 font-mono text-xs">{o.order_number}</td>
                  <td className="whitespace-nowrap px-5 py-2">{date(o.order_date)}</td>
                  <td className="px-5 py-2">{o.customers?.name}</td>
                  <td className="px-5 py-2">{o.status}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{thb(o.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
