"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireType } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const done = (q: Record<string, string>): never => {
  revalidatePath("/admin/users");
  redirect(`/admin/users?${new URLSearchParams(q)}`);
};
const num = (v: FormDataEntryValue | null) => Number(v) || 0;
const str = (v: FormDataEntryValue | null) => String(v ?? "");

/** Grant or revoke HR/Admin. Runs as the signed-in admin: RLS (has_role('admin')) is the real check. */
export async function setType(formData: FormData) {
  const me = await requireType("admin");
  const employeeId = num(formData.get("employee_id"));
  const role = str(formData.get("role"));
  const enable = formData.get("enable") === "1";
  if (!["hr", "admin"].includes(role)) done({ error: "Unknown type" });

  const supabase = await createClient();
  const { error } = enable
    ? await supabase.from("employee_roles").insert({ employee_id: employeeId, role, granted_by: me.employee_id })
    : await supabase.from("employee_roles").delete().eq("employee_id", employeeId).eq("role", role);
  if (error && error.code !== "23505") done({ error: error.message });
  done({ ok: `${enable ? "Granted" : "Removed"} ${role.toUpperCase()}` });
}

/** Create a login for an active employee. Email comes from employees, never from the form. */
export async function createAccount(formData: FormData) {
  await requireType("admin");
  const employeeId = num(formData.get("employee_id"));
  const password = str(formData.get("password"));
  if (password.length < 8) done({ error: "Password must be at least 8 characters" });

  const supabase = await createClient();
  const { data: emp } = await supabase.from("employees")
    .select("employee_code, email, is_active, termination_date").eq("employee_id", employeeId).maybeSingle();
  if (!emp || !emp.is_active || emp.termination_date) done({ error: "Only active employees can have a login" });

  // The auth.users trigger still blocks non-employees, even here.
  const { error } = await createAdminClient().auth.admin.createUser({ email: emp!.email, password, email_confirm: true });
  if (error) done({ error: error.message });
  done({ ok: `Login created for ${emp!.employee_code}` });
}

export async function resetPassword(formData: FormData) {
  await requireType("admin");
  const userId = str(formData.get("user_id"));
  const password = str(formData.get("password"));
  if (password.length < 8) done({ error: "Password must be at least 8 characters" });
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  if (error) done({ error: error.message });
  done({ ok: "Password changed" });
}

export async function deleteAccount(formData: FormData) {
  await requireType("admin");
  const userId = str(formData.get("user_id"));
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims.sub === userId) done({ error: "You can't delete your own login" });
  const { error } = await createAdminClient().auth.admin.deleteUser(userId);
  if (error) done({ error: error.message });
  done({ ok: "Login deleted" });
}
