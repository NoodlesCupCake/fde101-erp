import { TypeBadges } from "@/components/type-badges";
import { requireType, type UserType } from "@/lib/dal";
import { date } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createAccount, deleteAccount, resetPassword, setType } from "./actions";

type Emp = {
  employee_id: number; employee_code: string; first_name: string; last_name: string; email: string;
  job_title: string; manager_id: number | null; is_active: boolean; termination_date: string | null;
};

const btn = "h-8 rounded-md border border-line px-2.5 text-xs hover:bg-background";
const pw = "h-8 w-32 rounded-md border border-line bg-surface px-2 text-xs";

export default async function AdminUsers({ searchParams }: PageProps<"/admin/users">) {
  const me = await requireType("admin");
  const sp = await searchParams;
  const supabase = await createClient();

  const [emps, roles, accounts] = await Promise.all([
    supabase.from("employees")
      .select("employee_id, employee_code, first_name, last_name, email, job_title, manager_id, is_active, termination_date")
      .order("employee_code").returns<Emp[]>(),
    supabase.from("employee_roles").select("employee_id, role").returns<{ employee_id: number; role: "hr" | "admin" }[]>(),
    createAdminClient().auth.admin.listUsers({ perPage: 1000 }),
  ]);
  if (emps.error) throw new Error(emps.error.message);

  const rows = emps.data ?? [];
  const managers = new Set(rows.filter((r) => r.is_active).map((r) => r.manager_id));
  const has = (id: number, role: string) => (roles.data ?? []).some((r) => r.employee_id === id && r.role === role);
  const userByEmail = new Map((accounts.data?.users ?? []).map((u) => [u.email?.toLowerCase(), u]));
  const loginCount = rows.filter((r) => userByEmail.has(r.email.toLowerCase())).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Users &amp; types</h1>
        <p className="text-sm text-muted">
          {loginCount} of {rows.length} employees have a login. Manager is derived from the reporting line (manager_id);
          HR and Admin are granted here.
        </p>
      </div>
      {typeof sp.ok === "string" && <p role="status" className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">{sp.ok}</p>}
      {typeof sp.error === "string" && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{sp.error}</p>}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Employee</th><th className="px-4 py-2 font-medium">Types</th>
              <th className="px-4 py-2 font-medium">Change type</th><th className="px-4 py-2 font-medium">Login account</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const active = e.is_active && !e.termination_date;
              const user = userByEmail.get(e.email.toLowerCase());
              const types: UserType[] = ["employee", ...(managers.has(e.employee_id) ? ["manager" as const] : []),
                ...(["admin", "hr"] as const).filter((r) => has(e.employee_id, r))];
              return (
                <tr key={e.employee_id} className={`border-t border-line align-top ${active ? "" : "opacity-60"}`}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{e.first_name} {e.last_name} {e.employee_id === me.employee_id && <span className="text-xs text-brand">(you)</span>}</div>
                    <div className="text-xs text-muted"><span className="font-mono">{e.employee_code}</span> · {e.job_title}</div>
                    {!active && <div className="text-xs text-danger">Left {date(e.termination_date)}: can&apos;t sign in</div>}
                  </td>
                  <td className="px-4 py-2">{active && <TypeBadges types={types} />}</td>
                  <td className="px-4 py-2">
                    {active && (
                      <div className="flex flex-wrap gap-1.5">
                        {(["hr", "admin"] as const).map((role) => {
                          const on = has(e.employee_id, role);
                          return (
                            <form key={role} action={setType}>
                              <input type="hidden" name="employee_id" value={e.employee_id} />
                              <input type="hidden" name="role" value={role} />
                              <input type="hidden" name="enable" value={on ? "0" : "1"} />
                              <button className={btn}>{on ? `− ${role.toUpperCase()}` : `+ ${role.toUpperCase()}`}</button>
                            </form>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {user ? (
                      <div className="space-y-1.5">
                        <div className="text-xs text-muted">
                          Has login · last sign-in {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("en-GB") : "never"}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <form action={resetPassword} className="flex gap-1.5">
                            <input type="hidden" name="user_id" value={user.id} />
                            <input name="password" type="password" required minLength={8} placeholder="New password" className={pw} autoComplete="new-password" />
                            <button className={btn}>Reset</button>
                          </form>
                          {e.employee_id !== me.employee_id && (
                            <form action={deleteAccount}>
                              <input type="hidden" name="user_id" value={user.id} />
                              <button className={`${btn} text-danger`}>Delete login</button>
                            </form>
                          )}
                        </div>
                      </div>
                    ) : active ? (
                      <form action={createAccount} className="flex gap-1.5">
                        <input type="hidden" name="employee_id" value={e.employee_id} />
                        <input name="password" type="password" required minLength={8} placeholder="Password" className={pw} autoComplete="new-password" />
                        <button className={btn}>Create login</button>
                      </form>
                    ) : (
                      <span className="text-xs text-muted">–</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
