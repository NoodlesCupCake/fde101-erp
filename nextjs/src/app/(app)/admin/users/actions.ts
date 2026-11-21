"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/dal";
import { DEMO_CODES } from "@/lib/demo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Every action re-checks admin itself (never trust that the button was only shown to admins). */

const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();

/** Back to the page the form came from (only /admin/users… paths), with a message. */
function done(formData: FormData, q: Record<string, string>, path?: string): never {
  const back = str(formData.get("back"));
  const target = path ?? (back.startsWith("/admin/users") ? back.split("?")[0] : "/admin/users");
  revalidatePath("/admin/users", "layout");
  redirect(`${target}?${new URLSearchParams(q)}`);
}

async function employee(id: number) {
  const supabase = await createClient();
  const { data } = await supabase.from("employees")
    .select("employee_id, employee_code, email, is_active, termination_date").eq("employee_id", id).maybeSingle();
  return data;
}

async function loginFor(email: string) {
  const { data } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
  return data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

// ---------------------------------------------------------------- employees (C, U, D = terminate)
export async function createEmployee(formData: FormData) {
  await requirePermission("users.manage");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_employee", {
    p_first_name: str(formData.get("first_name")),
    p_last_name: str(formData.get("last_name")),
    p_email: str(formData.get("email")),
    p_department_id: num(formData.get("department_id")),
    p_job_title: str(formData.get("job_title")),
    p_manager_id: num(formData.get("manager_id")),
    p_monthly_salary: num(formData.get("monthly_salary")),
    p_hire_date: str(formData.get("hire_date")) || null,
  }).single<{ employee_id: number; employee_code: string }>();
  if (error || !data) done(formData, { error: error?.message ?? "Could not create employee" }, "/admin/users/new");

  const password = str(formData.get("password"));
  if (password) {
    if (password.length < 8) done(formData, { error: `${data.employee_code} created, but the password was too short, so no login was made` }, `/admin/users/${data.employee_id}`);
    const { error: e } = await createAdminClient().auth.admin.createUser({ email: str(formData.get("email")).toLowerCase(), password, email_confirm: true });
    if (e) done(formData, { error: `${data.employee_code} created, but the login failed: ${e.message}` }, `/admin/users/${data.employee_id}`);
  }
  done(formData, { ok: `Created ${data.employee_code}${password ? " with a login" : ""}` }, `/admin/users/${data.employee_id}`);
}

export async function updateEmployee(formData: FormData) {
  await requirePermission("users.manage");
  const id = num(formData.get("employee_id"))!;
  const before = await employee(id);
  if (!before) done(formData, { error: "Employee not found" });
  const email = str(formData.get("email")).toLowerCase();
  const emailChanged = email !== before.email.toLowerCase();
  if (emailChanged && DEMO_CODES.has(before.employee_code)) done(formData, { error: "Demo preset employees keep their email" });

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_employee", {
    p_employee_id: id,
    p_first_name: str(formData.get("first_name")),
    p_last_name: str(formData.get("last_name")),
    p_email: email,
    p_department_id: num(formData.get("department_id")),
    p_job_title: str(formData.get("job_title")),
    p_manager_id: num(formData.get("manager_id")),
    p_monthly_salary: num(formData.get("monthly_salary")),
  });
  if (error) done(formData, { error: error.message });

  // Account ↔ employee is matched by email, so the login must follow the new email.
  if (emailChanged) {
    const user = await loginFor(before.email);
    if (user) {
      const { error: e } = await createAdminClient().auth.admin.updateUserById(user.id, { email, email_confirm: true });
      if (e) done(formData, { error: `Saved, but the login email could not be updated: ${e.message}` });
    }
  }
  done(formData, { ok: "Saved" });
}

export async function terminateEmployee(formData: FormData) {
  await requirePermission("users.manage");
  const id = num(formData.get("employee_id"))!;
  const emp = await employee(id);
  if (!emp) done(formData, { error: "Employee not found" });
  if (DEMO_CODES.has(emp.employee_code)) done(formData, { error: "Demo preset employees can't be terminated" });

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_terminate_employee", { p_employee_id: id, p_date: str(formData.get("date")) || null });
  if (error) done(formData, { error: error.message });
  const user = await loginFor(emp.email);
  if (user) await createAdminClient().auth.admin.deleteUser(user.id); // they can't sign in anyway; remove the login too
  done(formData, { ok: `${emp.employee_code} terminated${user ? " and their login deleted" : ""}. Direct reports moved up to their manager.` });
}

export async function reactivateEmployee(formData: FormData) {
  await requirePermission("users.manage");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reactivate_employee", { p_employee_id: num(formData.get("employee_id")) });
  if (error) done(formData, { error: error.message });
  done(formData, { ok: "Reactivated. Create a login for them if they need one." });
}

// ---------------------------------------------------------------- types
/** Grant or revoke HR/Admin. Runs as the signed-in admin: RLS (has_role('admin')) is the real check. */
export async function setType(formData: FormData) {
  const me = await requirePermission("types.manage");
  const id = num(formData.get("employee_id"))!;
  const role = str(formData.get("role"));
  const enable = formData.get("enable") === "1";
  if (!["hr", "admin"].includes(role)) done(formData, { error: "Unknown type" });
  if (!enable && role === "admin" && (await employee(id))?.employee_code === "E0061") {
    done(formData, { error: "E0061 is the demo Admin preset, so it stays an admin" });
  }
  const supabase = await createClient();
  const { error } = enable
    ? await supabase.from("employee_roles").insert({ employee_id: id, role, granted_by: me.employee_id })
    : await supabase.from("employee_roles").delete().eq("employee_id", id).eq("role", role);
  if (error && error.code !== "23505") done(formData, { error: error.message });
  done(formData, { ok: `${enable ? "Granted" : "Removed"} ${role.toUpperCase()}` });
}

// ---------------------------------------------------------------- login accounts
export async function createAccount(formData: FormData) {
  await requirePermission("users.manage");
  const emp = await employee(num(formData.get("employee_id"))!);
  const password = str(formData.get("password"));
  if (password.length < 8) done(formData, { error: "Password must be at least 8 characters" });
  if (!emp || !emp.is_active || emp.termination_date) done(formData, { error: "Only active employees can have a login" });
  // The auth.users trigger still blocks non-employees, even here.
  const { error } = await createAdminClient().auth.admin.createUser({ email: emp.email, password, email_confirm: true });
  if (error) done(formData, { error: error.message });
  done(formData, { ok: `Login created for ${emp.employee_code}` });
}

async function isDemoLogin(userId: string) {
  const { data } = await createAdminClient().auth.admin.getUserById(userId);
  const email = data.user?.email?.toLowerCase();
  if (!email) return false;
  const supabase = await createClient();
  const { data: emp } = await supabase.from("employees").select("employee_code").eq("email", email).maybeSingle();
  return !!emp && DEMO_CODES.has(emp.employee_code);
}

export async function resetPassword(formData: FormData) {
  await requirePermission("users.manage");
  const userId = str(formData.get("user_id"));
  const password = str(formData.get("password"));
  if (password.length < 8) done(formData, { error: "Password must be at least 8 characters" });
  if (await isDemoLogin(userId)) done(formData, { error: "Demo preset logins can't have their password changed" });
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  if (error) done(formData, { error: error.message });
  done(formData, { ok: "Password changed" });
}

export async function deleteAccount(formData: FormData) {
  await requirePermission("users.manage");
  const userId = str(formData.get("user_id"));
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims.sub === userId) done(formData, { error: "You can't delete your own login" });
  if (await isDemoLogin(userId)) done(formData, { error: "Demo preset logins can't be deleted" });
  const { error } = await createAdminClient().auth.admin.deleteUser(userId);
  if (error) done(formData, { error: error.message });
  done(formData, { ok: "Login deleted" });
}
