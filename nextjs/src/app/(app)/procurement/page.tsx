import { FilterBar } from "@/components/filter-bar";
import { InfiniteRows } from "@/components/infinite-rows";
import { num } from "@/lib/format";
import { loadPos } from "./actions";
import { parsePoFilters, PO_STATUSES, poCount, poPage, PoRows, requireProcurement } from "./data";

export default async function PurchaseOrders({ searchParams }: PageProps<"/procurement">) {
  const { supabase } = await requireProcurement();
  const f = parsePoFilters(await searchParams);
  const [page, total, warehouses, suppliers] = await Promise.all([
    poPage(f), poCount(f),
    supabase.from("warehouses").select("warehouse_id, code, name").order("code"),
    supabase.from("suppliers").select("supplier_id, supplier_code, name").order("name"),
  ]);
  const raw = { q: f.q, status: f.status, supplier: f.supplier ? String(f.supplier) : "", warehouse: f.warehouse ? String(f.warehouse) : "", from: f.from, to: f.to };

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="space-y-3 border-b border-line px-5 py-3">
        <div>
          <h1 className="font-semibold">Purchase orders <span className="font-normal text-muted">({num(total)} found)</span></h1>
          <p className="text-xs text-muted">Requisition → approval → purchase order → goods receipts → supplier invoices (three-way match) → payments. Click a PO for the whole flow.</p>
        </div>
        <FilterBar fields={[
          { name: "q", type: "search", placeholder: "PO number or supplier…" },
          { name: "status", type: "select", label: "Status", options: PO_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ").toLowerCase() })) },
          { name: "supplier", type: "select", label: "Supplier", options: (suppliers.data ?? []).map((s) => ({ value: String(s.supplier_id), label: s.name })) },
          { name: "warehouse", type: "select", label: "Warehouse", options: (warehouses.data ?? []).map((w) => ({ value: String(w.warehouse_id), label: `${w.code} · ${w.name}` })) },
          { name: "from", type: "date", label: "From" },
          { name: "to", type: "date", label: "To" },
        ]} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr><th className="px-5 py-2 font-medium">PO</th><th className="px-5 py-2 font-medium">Ordered</th><th className="px-5 py-2 font-medium">Supplier</th>
              <th className="px-5 py-2 font-medium">Warehouse</th><th className="px-5 py-2 font-medium">Status</th><th className="px-5 py-2 font-medium">Approved by</th>
              <th className="px-5 py-2 text-right font-medium">Total incl. VAT</th></tr>
          </thead>
          <tbody>
            <PoRows rows={page.rows} />
            {page.rows.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-muted">No purchase orders match these filters.</td></tr>}
            <InfiniteRows key={JSON.stringify(raw)} next={page.next} load={loadPos.bind(null, raw)} colSpan={7} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
