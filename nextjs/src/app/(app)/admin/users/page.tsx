import Link from "next/link";
import { Pager } from "@/components/pager";
import { TypeBadges } from "@/components/type-badges";
import { cursorPage } from "@/lib/cursor";
import { requireType } from "@/lib/dal";
import { typesForPage } from "@/lib/employee-types";
import { date } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { setType } from "./actions";
import { btn, Flash } from "./shared";

type Emp = {
  employee_id: number; employee_code: string; first_name: string; last_name: string; email: string;
  job_title: string; manager_id: number | null; is_active: boolean; termination_date: string | null;
};

export default async function AdminUsers({ searchParams }: PageProps<"/admin/users">) {
  const me = await requireType("admin");
  const sp = await searchParams;
  const supabase = await createClient();

  const page = await cursorPage<Emp>({
    search: sp, size: 20, keys: ["employee_code"], descending: false,
    query: () => supabase.from("employees")
      .select("employee_id, employee_code, first_name, last_name, email, job_title, manager_id, is_active, termination_date"),
    keyOf: (r) => [r.employee_code],
  });
  const [{ typesOf }, accounts] = await Promise.all([
    typesForPage(supabase, page.rows.map((r) => r.employee_id), []),
    createAdminClient().auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const hasLogin = new Set((accounts.data?.users ?? []).map((u) => u.email?.toLowerCase()));
  const back = `/admin/users`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Users &amp; types</h1>
          <p className="text-sm text-muted">Manager comes from the reporting line. HR and Admin are granted here. Click an employee to edit.</p>
        </div>
        <Link href="/admin/users/new" className="h-9 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90">+ New employee</Link>
      </div>
      <Flash sp={sp} />

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <div className="flex justify-end border-b border-line px-4 py-2"><Pager base="/admin/users" prev={page.prev} next={page.next} /></div>
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Employee</th><th className="px-4 py-2 font-medium">Types</th>
              <th className="px-4 py-2 font-medium">Quick type change</th><th className="px-4 py-2 font-medium">Login</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((e) => {
              const active = e.is_active && !e.termination_date;
              const types = typesOf(e.employee_id);
              return (
                <tr key={e.employee_id} className={`border-t border-line ${active ? "" : "opacity-60"}`}>
                  <td className="px-4 py-2">
                    <Link href={`/admin/users/${e.employee_id}`} className="font-medium text-brand hover:underline">
                      {e.first_name} {e.last_name}
                    </Link>
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
                              <input type="hidden" name="back" value={back} />
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
            })}
          </tbody>
        </table>
        <div className="flex justify-end border-t border-line px-4 py-2"><Pager base="/admin/users" prev={page.prev} next={page.next} /></div>
      </div>
    </div>
  );
}
