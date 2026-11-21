import "server-only";
import Link from "next/link";
import { TypeBadges } from "@/components/type-badges";
import { cursorPage } from "@/lib/cursor";
import { applyEmployeeFilters, type EmployeeFilters } from "@/lib/employee-filters";
import type { Employee } from "@/lib/dal";
import { typesForPage } from "@/lib/employee-types";
import { date } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { setType } from "./actions";
import { btn } from "./shared";

type Emp = {
  employee_id: number; employee_code: string; first_name: string; last_name: string; email: string;
  job_title: string; is_active: boolean; termination_date: string | null;
};

/** One rendered page of the admin user list (caller must have checked requirePermission("users.manage")). */
export async function adminUsersPage(me: Employee, f: EmployeeFilters, after?: string) {
  const supabase = await createClient();
  const page = await cursorPage<Emp>({
    search: { after }, size: 25, keys: ["employee_code"], descending: false,
    query: () => applyEmployeeFilters(supabase.from("employees")
      .select("employee_id, employee_code, first_name, last_name, email, job_title, is_active, termination_date"), f),
    keyOf: (r) => [r.employee_code],
  });
  const [{ typesOf }, accounts] = await Promise.all([
    typesForPage(supabase, page.rows.map((r) => r.employee_id), []),
    createAdminClient().auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const hasLogin = new Set((accounts.data?.users ?? []).map((u) => u.email?.toLowerCase()));

  const rows = page.rows.map((e) => {
    const active = e.is_active && !e.termination_date;
    const types = typesOf(e.employee_id);
    return (
      <tr key={e.employee_id} className={`border-t border-line ${active ? "" : "opacity-60"}`}>
        <td className="px-4 py-2">
          <Link href={`/admin/users/${e.employee_id}`} className="font-medium text-brand hover:underline">{e.first_name} {e.last_name}</Link>
          {e.employee_id === me.employee_id && <span className="ml-1 text-xs text-brand">(you)</span>}
          <div className="text-xs text-muted"><span className="font-mono">{e.employee_code}</span> · {e.job_title}</div>
        </td>
        <td className="px-4 py-2">{active ? <TypeBadges types={types} /> : <span className="text-xs text-danger">Left {date(e.termination_date)}</span>}</td>
        <td className="px-4 py-2">
          {active && (
            <div className="flex flex-wrap gap-1.5">
              {(["hr", "admin"] as const).map((role) => {
                const on = types.includes(role);
                return (
                  <form key={role} action={setType}>
                    <input type="hidden" name="back" value="/admin/users" />
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
        <td className="px-4 py-2 text-xs">{hasLogin.has(e.email.toLowerCase()) ? <span className="text-ok">Yes</span> : <span className="text-muted">No</span>}</td>
      </tr>
    );
  });
  return { rows, next: page.next };
}
