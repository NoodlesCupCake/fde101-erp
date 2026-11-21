import Link from "next/link";
import { notFound } from "next/navigation";
import { TypeBadges } from "@/components/type-badges";
import { requireType } from "@/lib/dal";
import { DEMO_CODES } from "@/lib/demo";
import { typesForPage } from "@/lib/employee-types";
import { date } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createAccount, deleteAccount, reactivateEmployee, resetPassword, setType, terminateEmployee, updateEmployee } from "../actions";
import { btn, EmployeeFieldset, Flash, input } from "../shared";

export default async function EditEmployee({ params, searchParams }: PageProps<"/admin/users/[id]">) {
  const me = await requireType("admin");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: e } = await supabase.from("employees")
    .select("employee_id, employee_code, first_name, last_name, email, department_id, job_title, manager_id, hire_date, is_active, termination_date")
    .eq("employee_id", Number(id)).maybeSingle();
  if (!e) notFound();

  const [salary, { typesOf }, accounts] = await Promise.all([
    supabase.rpc("admin_employee_salary", { p_employee_id: e.employee_id }),
    typesForPage(supabase, [e.employee_id], []),
    createAdminClient().auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const user = accounts.data?.users.find((u) => u.email?.toLowerCase() === e.email.toLowerCase());
  const active = e.is_active && !e.termination_date;
  const types = typesOf(e.employee_id);
  const demo = DEMO_CODES.has(e.employee_code);
  const back = `/admin/users/${e.employee_id}`;
  const Hidden = () => (<><input type="hidden" name="back" value={back} /><input type="hidden" name="employee_id" value={e.employee_id} /></>);

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/admin/users" className="text-sm text-brand hover:underline">← Users &amp; types</Link>
      <div>
        <h1 className="text-xl font-semibold">{e.first_name} {e.last_name} <span className="font-mono text-base text-muted">{e.employee_code}</span></h1>
        <div className="mt-1 text-sm">{active ? <TypeBadges types={types} /> : <span className="text-danger">Terminated {date(e.termination_date)}</span>}
          {demo && <span className="ml-2 text-xs text-muted">Demo preset (protected)</span>}</div>
      </div>
      <Flash sp={sp} />

      <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Details</h2>
        <form action={updateEmployee} className="space-y-4">
          <Hidden />
          <EmployeeFieldset isNew={false} value={{ ...e, monthly_salary: (salary.data as number | null) ?? null }} />
          <button className="h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90">Save changes</button>
        </form>
      </section>

      {active && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-semibold">User type</h2>
          <p className="text-sm text-muted">Employee always. Manager = has active direct reports (change it with the reporting manager field). HR and Admin:</p>
          <div className="flex gap-2">
            {(["hr", "admin"] as const).map((role) => {
              const on = types.includes(role);
              return (
                <form key={role} action={setType}>
                  <Hidden /><input type="hidden" name="role" value={role} /><input type="hidden" name="enable" value={on ? "0" : "1"} />
                  <button className={btn}>{on ? `Remove ${role.toUpperCase()}` : `Make ${role.toUpperCase()}`}</button>
                </form>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Login account</h2>
        {user ? (
          <>
            <p className="text-sm text-muted">Has a login. Last sign-in: {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("en-GB") : "never"}</p>
            {!demo && (
              <div className="flex flex-wrap gap-2">
                <form action={resetPassword} className="flex gap-2">
                  <input type="hidden" name="back" value={back} /><input type="hidden" name="user_id" value={user.id} />
                  <input name="password" type="password" required minLength={8} placeholder="New password" autoComplete="new-password" className={`${input} w-44`} />
                  <button className={btn}>Reset password</button>
                </form>
                {e.employee_id !== me.employee_id && (
                  <form action={deleteAccount}>
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="user_id" value={user.id} />
                    <button className={`${btn} text-danger`}>Delete login</button>
                  </form>
                )}
              </div>
            )}
          </>
        ) : active ? (
          <form action={createAccount} className="flex gap-2">
            <Hidden />
            <input name="password" type="password" required minLength={8} placeholder="Password" autoComplete="new-password" className={`${input} w-44`} />
            <button className={btn}>Create login</button>
          </form>
        ) : (
          <p className="text-sm text-muted">Terminated employees can&apos;t have a login.</p>
        )}
      </section>

      {!demo && e.employee_id !== me.employee_id && (
        <section className="space-y-3 rounded-xl border border-danger/30 bg-surface p-5">
          <h2 className="font-semibold text-danger">{active ? "Terminate (delete)" : "Reactivate"}</h2>
          {active ? (
            <form action={terminateEmployee} className="flex flex-wrap items-center gap-2">
              <Hidden />
              <p className="w-full text-sm text-muted">Soft delete: history (orders, journals) is kept. Their login is deleted, they lose access everywhere, and their direct reports move up to their manager.</p>
              <input name="date" type="date" className={`${input} w-44`} />
              <button className={`${btn} border-danger/40 text-danger`}>Terminate employee</button>
            </form>
          ) : (
            <form action={reactivateEmployee}><Hidden /><button className={btn}>Reactivate employee</button></form>
          )}
        </section>
      )}
    </div>
  );
}
