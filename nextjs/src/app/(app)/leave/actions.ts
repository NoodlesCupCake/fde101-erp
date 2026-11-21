"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Thin wrappers. All rules (who may approve, balances, overlaps, past dates, weekends/holidays) live in the
 * database functions submit_leave / decide_leave / cancel_leave, so calling the API directly gets the same answer.
 */

export type LeaveFormState = { error?: string; ok?: string } | undefined;

export async function submitLeave(_prev: LeaveFormState, formData: FormData): Promise<LeaveFormState> {
  await getCurrentEmployee();
  const half = String(formData.get("half_day") ?? "");
  const start = String(formData.get("start_date") ?? "");
  const end = half ? start : String(formData.get("end_date") ?? "") || start;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_leave", {
    p_type: String(formData.get("leave_type") ?? ""),
    p_start: start || null,
    p_end: end || null,
    p_half_day: half || null,
    p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) return { error: error.message };
  revalidatePath("/leave", "layout");
  return { ok: `Request #${data} submitted. Your manager (or HR) will review it.` };
}

export async function cancelLeave(formData: FormData) {
  await getCurrentEmployee();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_leave", { p_request_id: Number(formData.get("request_id")) });
  revalidatePath("/leave", "layout");
  redirect(`/leave?${new URLSearchParams(error ? { error: error.message } : { ok: "Request cancelled" })}`);
}

export async function decideLeave(formData: FormData) {
  await getCurrentEmployee();
  const supabase = await createClient();
  const approve = formData.get("decision") === "approve";
  const { error } = await supabase.rpc("decide_leave", {
    p_request_id: Number(formData.get("request_id")),
    p_approve: approve,
    p_comment: String(formData.get("comment") ?? ""),
  });
  revalidatePath("/leave", "layout");
  redirect(`/leave/approvals?${new URLSearchParams(error ? { error: error.message } : { ok: approve ? "Approved" : "Rejected" })}`);
}
