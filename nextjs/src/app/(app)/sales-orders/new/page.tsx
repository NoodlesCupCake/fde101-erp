import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { OrderForm, type CustomerOption, type ProductOption } from "./form";

/** New sales order. Only customers this user can see (RLS) are offered; the database re-checks everything on save. */
export default async function NewSalesOrder() {
  await getCurrentEmployee();
  const supabase = await createClient();
  const { data: can } = await supabase.rpc("can_create_sales_order");
  if (can !== true) redirect("/sales-orders?ok=" + encodeURIComponent("Only Sales staff (or sales.create) can create orders"));
  const [customers, products] = await Promise.all([
    supabase.from("customers").select("customer_id, customer_code, name, segment, default_warehouse_id, warehouses(code), rep:employees(first_name, last_name)")
      .eq("is_active", true).order("name"),
    supabase.from("products").select("product_id, sku, name, uom, list_price").eq("is_active", true).is("discontinued_date", null).order("sku"),
  ]);
  const cs: CustomerOption[] = (customers.data ?? []).map((c) => {
    const w = c.warehouses as unknown as { code: string } | null, r = c.rep as unknown as { first_name: string; last_name: string } | null;
    return { id: c.customer_id, code: c.customer_code, name: c.name, segment: c.segment, warehouse_id: c.default_warehouse_id,
      warehouse: w?.code ?? "", rep: r ? `${r.first_name} ${r.last_name}` : "" };
  });
  const ps: ProductOption[] = (products.data ?? []).map((p) => ({ id: p.product_id, sku: p.sku, name: p.name, uom: p.uom, price: Number(p.list_price) }));

  return (
    <div className="space-y-4">
      <Link href="/sales-orders" className="text-sm text-brand hover:underline">← Sales orders</Link>
      <div>
        <h1 className="text-xl font-semibold">New sales order</h1>
        <p className="text-sm text-muted">Price comes from products.list_price. Discount: segment rate (Retail 0%, Contractor 4%, Wholesale 8%), up to +5% promo.
          The preview below is only a preview: the database computes the real totals (7% VAT).</p>
      </div>
      {cs.length === 0 ? <p className="text-sm text-muted">You have no customers.</p> : <OrderForm customers={cs} products={ps} />}
    </div>
  );
}
