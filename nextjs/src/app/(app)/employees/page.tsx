import { TypeBadges } from "@/components/type-badges";
import { getCurrentEmployee, type UserType } from "@/lib/dal";
import { date, thb } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Row = {
  employee_id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  job_title: string;
  manager_id: number | null;
  is_active: boolean;
  termination_date: string | null;
  departments: { code: string } | null;
};

/** Directory. Salaries only appear for HR: the database never sends them to anyone else. */
export default async function Employees() {
  const me = await getCurrentEmployee();
  const isHR = me.types.includes("hr");
  const supabase = await createClient();

  const [emps, roles, salaries] = await Promise.all([
    // monthly_salary isn't in this select on purpose: signed-in users have no column privilege for it.
    supabase.from("employees")
      .select("employee_id, employee_code, first_name, last_name, job_title, manager_id, is_active, termination_date, departments(code)")
      .order("employee_code").returns<Row[]>(),
    supabase.from("employee_roles").select("employee_id, role").returns<{ employee_id: number; role: UserType }[]>(),
    isHR ? supabase.rpc("visible_salaries") : Promise.resolve({ data: [] }),
  ]);
  if (emps.error) throw new Error(emps.error.message);

  const rows = emps.data ?? [];
  const byId = new Map(rows.map((r) => [r.employee_id, r]));
  const managers = new Set(rows.filter((r) => r.is_active && r.manager_id).map((r) => r.manager_id));
  type Salary = { employee_id: number; monthly_salary: number };
  const salary = new Map(((salaries.data ?? []) as Salary[]).map((s) => [s.employee_id, s.monthly_salary]));
  const typesOf = (r: Row): UserType[] => [
    "employee",
    ...(managers.has(r.employee_id) ? (["manager"] as const) : []),
    ...(roles.data ?? []).filter((x) => x.employee_id === r.employee_id).map((x) => x.role).sort(),
  ];

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-5 py-3">
        <h1 className="font-semibold">Employees</h1>
        <p className="text-sm text-muted">{isHR ? "You are HR, so you can see salaries." : "Salaries are visible to HR only."}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Code</th><th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Dept</th><th className="px-4 py-2 font-medium">Job title</th>
              <th className="px-4 py-2 font-medium">Reports to</th><th className="px-4 py-2 font-medium">Types</th>
              {isHR && <th className="px-4 py-2 text-right font-medium">Salary</th>}
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const mgr = e.manager_id ? byId.get(e.manager_id) : null;
              const active = e.is_active && !e.termination_date;
              return (
                <tr key={e.employee_id} className={`border-t border-line ${e.employee_id === me.employee_id ? "bg-brand/5" : ""} ${active ? "" : "opacity-60"}`}>
                  <td className="px-4 py-2 font-mono text-xs">{e.employee_code}</td>
                  <td className="whitespace-nowrap px-4 py-2">{e.first_name} {e.last_name}</td>
                  <td className="px-4 py-2">{e.departments?.code}</td>
                  <td className="px-4 py-2">{e.job_title}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-muted">{mgr ? `${mgr.first_name} ${mgr.last_name}` : "–"}</td>
                  <td className="px-4 py-2">{active ? <TypeBadges types={typesOf(e)} /> : null}</td>
                  {isHR && <td className="px-4 py-2 text-right tabular-nums">{thb(salary.get(e.employee_id) ?? null)}</td>}
                  <td className="whitespace-nowrap px-4 py-2">{active ? <span className="text-ok">Active</span> : <span className="text-danger">Left {date(e.termination_date)}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
