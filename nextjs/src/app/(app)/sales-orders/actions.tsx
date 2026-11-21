"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { MoreRows } from "@/components/infinite-rows";
import { getCurrentEmployee } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { parseSalesFilters, SalesOrderRows, salesOrdersPage } from "./data";

/** Infinite scroll: next page with the same filters, already rendered. Re-checks the session and re-cleans filters. */
export async function loadSalesOrders(filters: Record<string, string>, cursor: string): Promise<MoreRows> {
  await getCurrentEmployee();
  const page = await salesOrdersPage(parseSalesFilters(filters), cursor);
  return { rows: <SalesOrderRows rows={page.rows} />, next: page.next };
}

export type Availability = { product_id: number; on_hand: number; on_open_orders: number; available: number };

/** Live stock check for the order form (the database checks again when the order is saved). */
export async function checkAvailability(warehouseId: number, productIds: number[]): Promise<Availability[]> {
  await getCurrentEmployee();
  const ids = productIds.filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
  if (!ids.length || !Number.isInteger(warehouseId)) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("sales_available", { p_warehouse_id: warehouseId, p_product_ids: ids });
  return (data ?? []) as Availability[];
}

export type OrderFormState = { error?: string } | undefined;

/**
 * Thin wrapper: only customer, product ids, quantities and discount % go to the database. create_sales_order()
 * takes the price from products.list_price and computes every amount, so a tampered request can't change the totals.
 */
export async function createSalesOrder(_prev: OrderFormState, formData: FormData): Promise<OrderFormState> {
  await getCurrentEmployee();
  let lines: unknown;
  try { lines = JSON.parse(String(formData.get("lines") ?? "[]")); } catch { return { error: "Invalid lines" }; }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_sales_order", {
    p_customer_id: Number(formData.get("customer_id")),
    p_lines: lines,
    p_requested_date: String(formData.get("requested_date") ?? "") || null,
  }).maybeSingle<{ sales_order_id: number; order_number: string; backorder_lines: { sku: string }[] }>();
  if (error || !data) return { error: error?.message ?? "Could not create the order" };
  revalidatePath("/", "layout");
  const back = data.backorder_lines.length ? `&backorder=${encodeURIComponent(data.backorder_lines.map((l) => l.sku).join(","))}` : "";
  redirect(`/sales-orders/${data.sales_order_id}?created=1${back}`);
}
