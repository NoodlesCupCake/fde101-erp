import "server-only";
import { TypeBadges } from "@/components/type-badges";
import { cursorPage } from "@/lib/cursor";
import type { Employee } from "@/lib/dal";
import { typesForPage } from "@/lib/employee-types";
import { date, thb } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Row = {
  employee_id: number; employee_code: string; first_name: string; last_name: string; job_title: string;
  manager_id: number | null; is_active: boolean; termination_date: string | null; departments: { code: string } | null;
};
type Salary = { employee_id: number; monthly_salary: number };

/** One rendered page of the directory. Salaries are only fetched (and only returned by the DB) for HR. */
export async function employeesPage(me: Employee, after?: string) {
  const isHR = me.types.includes("hr");
  const supabase = await createClient();
  const page = await cursorPage<Row>({
    search: { after }, size: 25, keys: ["employee_code"], descending: false,
    // monthly_salary isn't selectable for signed-in users (no column privilege), so it's not here.
    query: () => supabase.from("employees")
      .select("employee_id, employee_code, first_name, last_name, job_title, manager_id, is_active, termination_date, departments(code)"),
    keyOf: (r) => [r.employee_code],
  });
  const ids = page.rows.map((r) => r.employee_id);
  const [{ typesOf, managerName }, salaries] = await Promise.all([
    typesForPage(supabase, ids, page.rows.flatMap((r) => (r.manager_id ? [r.manager_id] : []))),
    isHR ? supabase.rpc("visible_salaries").in("employee_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const salary = new Map(((salaries.data ?? []) as Salary[]).map((s) => [s.employee_id, s.monthly_salary]));

  const rows = page.rows.map((e) => {
    const active = e.is_active && !e.termination_date;
    return (
      <tr key={e.employee_id} className={`border-t border-line ${e.employee_id === me.employee_id ? "bg-brand/5" : ""} ${active ? "" : "opacity-60"}`}>
        <td className="px-4 py-2 font-mono text-xs">{e.employee_code}</td>
        <td className="whitespace-nowrap px-4 py-2">{e.first_name} {e.last_name}</td>
        <td className="px-4 py-2">{e.departments?.code}</td>
        <td className="px-4 py-2">{e.job_title}</td>
        <td className="whitespace-nowrap px-4 py-2 text-muted">{(e.manager_id && managerName.get(e.manager_id)) || "–"}</td>
        <td className="px-4 py-2">{active ? <TypeBadges types={typesOf(e.employee_id)} /> : null}</td>
        {isHR && <td className="px-4 py-2 text-right tabular-nums">{thb(salary.get(e.employee_id) ?? null)}</td>}
        <td className="whitespace-nowrap px-4 py-2">{active ? <span className="text-ok">Active</span> : <span className="text-danger">Left {date(e.termination_date)}</span>}</td>
      </tr>
    );
  });
  return { rows, next: page.next, isHR };
}
