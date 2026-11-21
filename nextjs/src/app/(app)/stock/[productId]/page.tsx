import Link from "next/link";
import { notFound } from "next/navigation";
import { FilterBar } from "@/components/filter-bar";
import { SqlBlock } from "@/components/sql-block";
import { id, one } from "@/lib/filters";
import { date, num, thb } from "@/lib/format";
import { AS_OF, requireStock, type StockRow } from "../data";
import { skuSql } from "../sql";

type Movement = {
  inventory_txn_id: number; txn_date: string; warehouse: string; txn_type: string; quantity: number; unit_cost: number;
  total_cost: number; reference_type: string | null; reference_id: number | null; running_qty: number; running_value: number;
};
const TYPE_STYLE: Record<string, string> = { OPENING: "text-muted", RECEIPT: "text-ok", SHIPMENT: "text-foreground", ADJUSTMENT: "text-danger" };

/** Drill-down: one product's movements, newest first, with the running balance per warehouse. */
export default async function ProductStock({ params, searchParams }: PageProps<"/stock/[productId]">) {
  const { supabase } = await requireStock();
  const [{ productId }, sp] = await Promise.all([params, searchParams]);
  const pid = id(productId);
  if (!pid) notFound();
  const warehouse = id(one(sp, "warehouse"));

  const [product, moves, summary, warehouses] = await Promise.all([
    supabase.from("products").select("product_id, sku, name, uom, product_categories(name)").eq("product_id", pid).maybeSingle(),
    supabase.rpc("product_movements", { p_product_id: pid, p_warehouse_id: warehouse }),
    supabase.rpc("stock_on_hand", { p_warehouse_id: warehouse, p_category_id: null, p_as_of: AS_OF }).eq("product_id", pid),
    supabase.from("warehouses").select("warehouse_id, code, name").order("code"),
  ]);
  if (!product.data) notFound();
  const rows = (moves.data ?? []) as Movement[];
  const s = (summary.data ?? []) as StockRow[];
  const onHand = s.reduce((a, r) => a + r.on_hand, 0);
  const value = s.reduce((a, r) => a + Number(r.stock_value), 0);
  const cat = product.data.product_categories as unknown as { name: string } | null;

  return (
    <div className="space-y-5">
      <Link href="/stock" className="text-sm text-brand hover:underline">← Stock</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{product.data.name}</h1>
          <p className="text-sm text-muted"><span className="font-mono">{product.data.sku}</span> · {cat?.name} · unit: {product.data.uom}</p>
        </div>
        <FilterBar fields={[{ name: "warehouse", type: "select", label: "Warehouse", options: (warehouses.data ?? []).map((w) => ({ value: String(w.warehouse_id), label: w.code })) }]} />
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { l: "On hand", v: `${num(onHand)} ${product.data.uom}` },
          { l: "Stock value", v: thb(value) },
          { l: "Movements", v: num(rows.length) },
          { l: "Reorder point", v: s.length === 1 ? num(s[0].reorder_point) : `${s.map((r) => `${r.warehouse} ${r.reorder_point}`).join(" · ")}` },
        ].map((k) => (
          <div key={k.l} className="rounded-xl border border-line bg-surface p-4">
            <div className="text-sm text-muted">{k.l}</div><div className="mt-1 text-lg font-semibold tabular-nums">{k.v}</div>
          </div>
        ))}
      </section>

      <SqlBlock title={`check ${product.data.sku} by hand`} sql={skuSql(product.data.sku, warehouse)}
        note={`Run in Supabase → SQL Editor. on_hand and stock_value should match the cards above${warehouse ? "" : " (summed over warehouses)"}.`} />

      <section className="rounded-xl border border-line bg-surface">
        <h2 className="border-b border-line px-5 py-3 font-semibold">Movements</h2>
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-muted">
              <tr><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Warehouse</th><th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th><th className="px-4 py-2 text-right font-medium">Unit cost</th>
                <th className="px-4 py-2 text-right font-medium">Value</th><th className="px-4 py-2 text-right font-medium">Balance qty</th>
                <th className="px-4 py-2 text-right font-medium">Balance value</th><th className="px-4 py-2 font-medium">Reference</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.inventory_txn_id} className="border-t border-line">
                  <td className="whitespace-nowrap px-4 py-1.5">{date(m.txn_date)}</td>
                  <td className="px-4 py-1.5">{m.warehouse}</td>
                  <td className={`px-4 py-1.5 text-xs font-medium ${TYPE_STYLE[m.txn_type] ?? ""}`}>{m.txn_type}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{m.quantity > 0 ? "+" : ""}{num(m.quantity)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-muted">{thb(m.unit_cost)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{thb(m.total_cost)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{num(Number(m.running_qty))}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{thb(m.running_value)}</td>
                  <td className="whitespace-nowrap px-4 py-1.5 text-xs text-muted">{m.reference_type ?? ""}{m.reference_id ? ` #${m.reference_id}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
