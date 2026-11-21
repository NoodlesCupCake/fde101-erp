import "server-only";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export const AS_OF = "2026-10-31"; // the dataset's "today"

export type StockRow = {
  product_id: number; sku: string; product: string; category_id: number; category: string; warehouse_id: number; warehouse: string;
  on_hand: number; stock_value: number; avg_cost: number | null; reorder_point: number; reorder_qty: number; below_reorder: boolean;
  shipped_90d: number; days_of_cover: number | null; last_shipment: string | null; dead_stock: boolean;
  shrink_units_365d: number; shrink_value_365d: number;
};

/** Page guard: same rule as the database (can_view_stock()), which also guards every stock function. */
export async function requireStock() {
  const me = await getCurrentEmployee();
  const supabase = await createClient();
  const { data } = await supabase.rpc("can_view_stock");
  if (data !== true) redirect("/?denied=stock.view");
  return { me, supabase };
}
