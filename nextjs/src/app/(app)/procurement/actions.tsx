"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { MoreRows } from "@/components/infinite-rows";
import { getCurrentEmployee } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { parsePoFilters, poPage, PoRows } from "./data";

/** Infinite scroll for the PO list: same filters, re-cleaned; RLS decides what comes back. */
export async function loadPos(filters: Record<string, string>, cursor: string): Promise<MoreRows> {
  await getCurrentEmployee();
  const page = await poPage(parsePoFilters(filters), cursor);
  return { rows: <PoRows rows={page.rows} />, next: page.next };
}

/**
 * Thin wrappers. Price, amount, approval level, who may approve and the PO itself are all decided by the database
 * (submit_requisition / decide_requisition + the trigger on purchase_orders), so the API gives the same answer.
 */
export type ReqFormState = { error?: string } | undefined;

export async function submitRequisition(_prev: ReqFormState, formData: FormData): Promise<ReqFormState> {
  await getCurrentEmployee();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_requisition", {
    p_product_id: Number(formData.get("product_id")),
    p_warehouse_id: Number(formData.get("warehouse_id")),
    p_supplier_id: Number(formData.get("supplier_id")),
    p_quantity: Number(formData.get("quantity")),
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect(`/procurement/requisitions/${data}?ok=created`);
}

export async function decideRequisition(formData: FormData) {
  await getCurrentEmployee();
  const supabase = await createClient();
  const id = Number(formData.get("requisition_id"));
  const approve = formData.get("decision") === "approve";
  const { error } = await supabase.rpc("decide_requisition", { p_requisition_id: id, p_approve: approve, p_reason: String(formData.get("reason") ?? "") });
  revalidatePath("/", "layout");
  const back = String(formData.get("back") ?? "") === "detail" ? `/procurement/requisitions/${id}` : "/procurement/requisitions";
  redirect(`${back}?${new URLSearchParams(error ? { error: error.message } : { ok: approve ? "Approved: purchase order created" : "Rejected" })}`);
}
