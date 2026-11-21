import Link from "next/link";
import { getCurrentEmployee } from "@/lib/dal";
import { date, num, thb } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 25;

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
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  const { data, count, error } = await supabase
    .from("sales_orders")
    .select("sales_order_id, order_number, order_date, status, total_amount, customers(name), warehouses(code)", { count: "exact" })
    .order("order_date", { ascending: false })
    .order("sales_order_id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    .returns<Order[]>();
  if (error) throw new Error(error.message);

  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h1 className="font-semibold">Sales orders <span className="font-normal text-muted">({num(count)})</span></h1>
        <div className="flex items-center gap-2 text-sm">
          {page > 1 && <Link className="rounded-md border border-line px-3 py-1 hover:bg-background" href={`/sales-orders?page=${page - 1}`}>Previous</Link>}
          <span className="text-muted">Page {page} of {num(pages)}</span>
          {page < pages && <Link className="rounded-md border border-line px-3 py-1 hover:bg-background" href={`/sales-orders?page=${page + 1}`}>Next</Link>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr><th className="px-5 py-2 font-medium">Order</th><th className="px-5 py-2 font-medium">Date</th><th className="px-5 py-2 font-medium">Customer</th><th className="px-5 py-2 font-medium">Warehouse</th><th className="px-5 py-2 font-medium">Status</th><th className="px-5 py-2 text-right font-medium">Total</th></tr>
          </thead>
          <tbody>
            {(data ?? []).map((o) => (
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
    </div>
  );
}
