import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { id, one } from "@/lib/filters";
import { num } from "@/lib/format";
import { requireProcurement } from "../../data";
import { RequisitionForm, type SupplierOption } from "./form";

/** Create a requisition for one low-stock item. Suggests the preferred supplier from supplier_products. */
export default async function NewRequisition({ searchParams }: PageProps<"/procurement/requisitions/new">) {
  const { supabase } = await requireProcurement();
  const sp = await searchParams;
  const productId = id(one(sp, "product"));
  const warehouseId = id(one(sp, "warehouse"));
  if (!productId || !warehouseId) redirect("/stock?view=reorder#list");
  const { data: allowed } = await supabase.rpc("can_create_requisition");
  if (allowed !== true) redirect("/procurement/requisitions?error=" + encodeURIComponent("Not allowed: requisition.create (Warehouse/Purchasing staff, or a type with that permission)"));

  const [product, warehouse, stock, suppliers, pending] = await Promise.all([
    supabase.from("products").select("product_id, sku, name, uom").eq("product_id", productId).maybeSingle(),
    supabase.from("warehouses").select("warehouse_id, code, name").eq("warehouse_id", warehouseId).maybeSingle(),
    supabase.rpc("stock_on_hand", { p_warehouse_id: warehouseId, p_category_id: null }).eq("product_id", productId).maybeSingle<{ on_hand: number; reorder_point: number }>(),
    supabase.from("supplier_products").select("supplier_id, unit_cost, lead_time_days, min_order_qty, is_preferred, suppliers(name, supplier_code)")
      .eq("product_id", productId).order("is_preferred", { ascending: false }).order("unit_cost"),
    supabase.from("purchase_requisitions").select("requisition_id, requisition_number, purchase_requisition_lines!inner(product_id)", { count: "exact" })
      .eq("status", "PENDING_APPROVAL").eq("warehouse_id", warehouseId).eq("purchase_requisition_lines.product_id", productId).limit(1),
  ]);
  if (!product.data || !warehouse.data) notFound();
  const s = stock.data;
  const options: SupplierOption[] = (suppliers.data ?? []).map((x) => {
    const sup = x.suppliers as unknown as { name: string; supplier_code: string } | null;
    return { supplier_id: x.supplier_id, name: sup?.name ?? "", code: sup?.supplier_code ?? "", unit_cost: Number(x.unit_cost),
      lead_time_days: x.lead_time_days, min_order_qty: x.min_order_qty, is_preferred: x.is_preferred };
  });
  const short = s ? Math.max(s.reorder_point - s.on_hand, 0) : 0;
  const waiting = pending.data?.[0];

  return (
    <div className="max-w-3xl space-y-5">
      <Link href={`/stock?view=reorder&warehouse=${warehouseId}#list`} className="text-sm text-brand hover:underline">← Below reorder point</Link>
      <div>
        <h1 className="text-xl font-semibold">New purchase requisition</h1>
        <p className="text-sm text-muted">{product.data.name} <span className="font-mono">{product.data.sku}</span> → {warehouse.data.code} · {warehouse.data.name}</p>
      </div>
      {s && (
        <div className="grid grid-cols-3 gap-3 text-sm">
          {[{ l: "On hand", v: num(s.on_hand) }, { l: "Reorder point", v: num(s.reorder_point) }, { l: "Short by", v: num(short), alert: short > 0 }].map((k) => (
            <div key={k.l} className="rounded-xl border border-line bg-surface p-3">
              <div className="text-muted">{k.l}</div><div className={`text-lg font-semibold tabular-nums ${k.alert ? "text-danger" : ""}`}>{k.v} {product.data!.uom}</div>
            </div>
          ))}
        </div>
      )}
      {waiting ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          <Link href={`/procurement/requisitions/${waiting.requisition_id}`} className="font-mono underline">{waiting.requisition_number}</Link> for this item is already waiting for approval.
        </p>
      ) : options.length === 0 ? (
        <p className="text-sm text-danger">No supplier sells this product (no row in supplier_products).</p>
      ) : (
        <RequisitionForm productId={productId} warehouseId={warehouseId} uom={product.data.uom} suggested={Math.max(short, 1)} options={options} />
      )}
    </div>
  );
}
