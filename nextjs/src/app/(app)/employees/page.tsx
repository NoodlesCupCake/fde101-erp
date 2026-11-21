import { getCurrentEmployee } from "@/lib/dal";
import { date } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Row = {
  employee_id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  job_title: string;
  is_active: boolean;
  termination_date: string | null;
  departments: { name: string } | null;
};

/** Who can sign in: only rows that are active with no termination date. */
export default async function Employees() {
  const me = await getCurrentEmployee();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("employee_id, employee_code, first_name, last_name, email, job_title, is_active, termination_date, departments(name)")
    .order("employee_code")
    .returns<Row[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const active = rows.filter((r) => r.is_active && !r.termination_date).length;

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-5 py-3">
        <h1 className="font-semibold">Employees</h1>
        <p className="text-sm text-muted">{active} of {rows.length} can sign in. Inactive or terminated employees are blocked at registration, sign-in and in the database.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr><th className="px-5 py-2 font-medium">Code</th><th className="px-5 py-2 font-medium">Name</th><th className="px-5 py-2 font-medium">Department</th><th className="px-5 py-2 font-medium">Job title</th><th className="px-5 py-2 font-medium">Email</th><th className="px-5 py-2 font-medium">Access</th></tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const allowed = e.is_active && !e.termination_date;
              return (
                <tr key={e.employee_id} className={`border-t border-line ${e.employee_id === me.employee_id ? "bg-brand/5" : ""}`}>
                  <td className="px-5 py-2 font-mono text-xs">{e.employee_code}</td>
                  <td className="whitespace-nowrap px-5 py-2">{e.first_name} {e.last_name}</td>
                  <td className="px-5 py-2">{e.departments?.name}</td>
                  <td className="px-5 py-2">{e.job_title}</td>
                  <td className="px-5 py-2 text-muted">{e.email}</td>
                  <td className="whitespace-nowrap px-5 py-2">
                    {allowed ? <span className="text-ok">Active</span> : <span className="text-danger">Blocked · left {date(e.termination_date)}</span>}
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
