"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/** Flip one cell of the matrix. RLS (has_permission('permissions.manage')) and the lock-out trigger are the real checks. */
export async function setPermission(formData: FormData) {
  const me = await requirePermission("permissions.manage");
  const role = String(formData.get("role"));
  const permission = String(formData.get("permission"));
  const allowed = formData.get("allowed") === "1";
  const supabase = await createClient();
  const { data, error } = await supabase.from("role_permissions")
    .update({ allowed, updated_by: me.employee_id }).eq("role", role).eq("permission", permission).select("role");
  revalidatePath("/", "layout"); // nav, salary columns etc. depend on permissions
  const q: Record<string, string> = error ? { error: error.message } : !data?.length ? { error: "Not allowed" }
    : { ok: `${role} ${allowed ? "can" : "cannot"} ${permission} now` };
  redirect(`/permissions?${new URLSearchParams(q)}`);
}
