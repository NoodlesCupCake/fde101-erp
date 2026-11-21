import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { id, one, oneOf } from "@/lib/filters";
import { date, num, thb } from "@/lib/format";
import { AS_OF, requireStock, type StockRow } from "./data";
import { ValueChart, type MonthPoint } from "./value-chart";

const VIEWS = ["value", "reorder", "dead", "shrinkage"] as const;
const VIEW_LABEL: Record<(typeof VIEWS)[number], string> = {
  value: "All items (by value)", reorder: "Below reorder point", dead: "Dead stock (no sale in 90 days)", shrinkage: "Shrinkage (last 12 months)",
};
const LIMIT = 100;

export default async function StockDashboard({ searchParams }: PageProps<"/stock">) {
  const { supabase } = await requireStock();
  const sp = await searchParams;
  const warehouse = id(one(sp, "warehouse"));
  const category = id(one(sp, "category"));
  const view = oneOf(one(sp, "view"), VIEWS) || "value";

  // Aggregation happens in the database (stock_on_hand / stock_value_by_month), never over raw rows in the browser.
  const [onHand, months, warehouses, categories] = await Promise.all([
    supabase.rpc("stock_on_hand", { p_warehouse_id: warehouse, p_category_id: category, p_as_of: AS_OF }),
    supabase.rpc("stock_value_by_month", { p_warehouse_id: warehouse, p_category_id: category }),
    supabase.from("warehouses").select("warehouse_id, code, name").order("code"),
    supabase.from("product_categories").select("category_id, name").order("name"),
  ]);
  if (onHand.error) throw new Error(onHand.error.message);
  const all = (onHand.data ?? []) as StockRow[];

  const total = all.reduce((s, r) => s + Number(r.stock_value), 0);
  const below = all.filter((r) => r.below_reorder);
  const dead = all.filter((r) => r.dead_stock);
  const shrink = all.reduce((s, r) => s + Number(r.shrink_value_365d), 0);
  const kpis = [
    { label: "Stock value", value: thb(total), note: `${num(all.length)} product × warehouse` },
    { label: "Below reorder point", value: num(below.length), note: "need a purchase order" },
    { label: "Dead stock", value: thb(dead.reduce((s, r) => s + Number(r.stock_value), 0)), note: `${dead.length} items, no sale in 90 days` },
    { label: "Shrinkage, 12 months", value: thb(shrink), note: "from ADJUSTMENT movements" },
  ];

  const rows = (view === "reorder" ? [...below].sort((a, b) => (a.on_hand - a.reorder_point) - (b.on_hand - b.reorder_point))
    : view === "dead" ? [...dead].sort((a, b) => b.stock_value - a.stock_value)
    : view === "shrinkage" ? all.filter((r) => r.shrink_units_365d > 0).sort((a, b) => b.shrink_value_365d - a.shrink_value_365d)
    : [...all].sort((a, b) => b.stock_value - a.stock_value));
  const shown = rows.slice(0, LIMIT);
  const monthRows = (months.data ?? []) as MonthPoint[];
  const whCodes = [...new Set(monthRows.map((m) => m.warehouse))].sort();
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(warehouse ? { warehouse: String(warehouse) } : {}), ...extra }).toString();

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold">Stock</h1>
          <p className="text-sm text-muted">As of {date(AS_OF)}. On hand = sum of signed quantities; value = sum of movement costs at moving-average cost (ties to GL 1200 Inventory).</p>
        </div>
        <FilterBar fields={[
          { name: "warehouse", type: "select", label: "Warehouse", options: (warehouses.data ?? []).map((w) => ({ value: String(w.warehouse_id), label: `${w.code} · ${w.name}` })) },
          { name: "category", type: "select", label: "Category", options: (categories.data ?? []).map((c) => ({ value: String(c.category_id), label: c.name })) },
        ]} />
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-line bg-surface p-4">
            <div className="text-sm text-muted">{k.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{k.value}</div>
            <div className="text-xs text-muted">{k.note}</div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="mb-2 font-semibold">Stock value by warehouse, month-end</h2>
        <ValueChart data={monthRows.map((m) => ({ ...m, stock_value: Number(m.stock_value) }))} warehouses={whCodes} />
      </section>

      <section className="rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="font-semibold">{VIEW_LABEL[view]} <span className="font-normal text-muted">({num(rows.length)}{rows.length > LIMIT ? `, showing ${LIMIT}` : ""})</span></h2>
          <FilterBar fields={[{ name: "view", type: "select", label: "List", options: VIEWS.filter((v) => v !== "value").map((v) => ({ value: v, label: VIEW_LABEL[v] })) }]} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Product</th><th className="px-4 py-2 font-medium">Warehouse</th>
                <th className="px-4 py-2 text-right font-medium">On hand</th><th className="px-4 py-2 text-right font-medium">Reorder pt</th>
                <th className="px-4 py-2 text-right font-medium">Value</th><th className="px-4 py-2 text-right font-medium">Avg cost</th>
                <th className="px-4 py-2 text-right font-medium">Days of cover</th>
                <th className="px-4 py-2 font-medium">{view === "shrinkage" ? "Shrinkage 12m" : "Last sale"}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.product_id}-${r.warehouse_id}`} className="border-t border-line">
                  <td className="px-4 py-2">
                    <Link href={`/stock/${r.product_id}?${qs({ warehouse: String(r.warehouse_id) })}`} className="font-medium text-brand hover:underline">{r.product}</Link>
                    <div className="text-xs text-muted"><span className="font-mono">{r.sku}</span> · {r.category}</div>
                  </td>
                  <td className="px-4 py-2">{r.warehouse}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {num(r.on_hand)}
                    {r.below_reorder && <div className="text-xs text-danger">▼ {num(r.reorder_point - r.on_hand)} short</div>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">{num(r.reorder_point)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{thb(r.stock_value)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">{r.avg_cost == null ? "–" : thb(r.avg_cost)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.days_of_cover == null ? (r.on_hand > 0 ? "∞" : "–") : Number(r.days_of_cover)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">
                    {view === "shrinkage" ? `${num(r.shrink_units_365d)} units · ${thb(r.shrink_value_365d)}` : r.last_shipment ? date(r.last_shipment) : "never"}
                    {r.dead_stock && view !== "shrinkage" && <div className="text-danger">dead stock</div>}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">Nothing in this list.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-muted">Days of cover = on hand ÷ average daily units shipped over the last 90 days. Dead stock = on hand but no shipment in 90 days.</p>
    </div>
  );
}
