import "server-only";
import { createClient } from "@/lib/supabase/server";

export const btn = "h-8 rounded-md border border-line px-2.5 text-xs hover:bg-background";
export const input = "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm";

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  if (typeof sp.ok === "string") return <p role="status" className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">{sp.ok}</p>;
  if (typeof sp.error === "string") return <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{sp.error}</p>;
  return null;
}

export type EmployeeFields = {
  employee_id?: number; first_name?: string; last_name?: string; email?: string; department_id?: number;
  job_title?: string; manager_id?: number | null; monthly_salary?: number | null;
};

/** Create/edit form fields. Departments and active managers come from the database. */
export async function EmployeeFieldset({ value = {}, isNew }: { value?: EmployeeFields; isNew: boolean }) {
  const supabase = await createClient();
  const [depts, people] = await Promise.all([
    supabase.from("departments").select("department_id, code, name").order("code"),
    supabase.from("employees").select("employee_id, employee_code, first_name, last_name, job_title")
      .eq("is_active", true).is("termination_date", null).order("employee_code"),
  ]);
  const label = "block space-y-1 text-sm";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={label}><span className="font-medium">First name</span><input name="first_name" required defaultValue={value.first_name} className={input} /></label>
      <label className={label}><span className="font-medium">Last name</span><input name="last_name" required defaultValue={value.last_name} className={input} /></label>
      <label className={label}><span className="font-medium">Email (the login is matched by this)</span><input name="email" type="email" required defaultValue={value.email} className={input} /></label>
      <label className={label}><span className="font-medium">Job title</span><input name="job_title" required defaultValue={value.job_title} className={input} /></label>
      <label className={label}><span className="font-medium">Department</span>
        <select name="department_id" required defaultValue={value.department_id ?? ""} className={input}>
          <option value="" disabled>Choose…</option>
          {(depts.data ?? []).map((d) => <option key={d.department_id} value={d.department_id}>{d.code} · {d.name}</option>)}
        </select>
      </label>
      <label className={label}><span className="font-medium">Reporting manager</span>
        <select name="manager_id" defaultValue={value.manager_id ?? ""} className={input}>
          <option value="">None (top of the organization)</option>
          {(people.data ?? []).filter((p) => p.employee_id !== value.employee_id).map((p) => (
            <option key={p.employee_id} value={p.employee_id}>{p.employee_code} · {p.first_name} {p.last_name} · {p.job_title}</option>
          ))}
        </select>
      </label>
      <label className={label}><span className="font-medium">Monthly salary (THB)</span>
        <input name="monthly_salary" type="number" min={0} step="0.01" required={isNew} defaultValue={value.monthly_salary ?? ""}
          placeholder={isNew ? "" : "Hidden (HR only). Leave empty to keep it"} className={input} />
      </label>
      {isNew && (
        <>
          <label className={label}><span className="font-medium">Hire date</span><input name="hire_date" type="date" className={input} /></label>
          <label className={`${label} sm:col-span-2`}><span className="font-medium">Login password (optional)</span>
            <input name="password" type="password" minLength={8} autoComplete="new-password" placeholder="Leave empty to create the login later" className={input} />
          </label>
        </>
      )}
    </div>
  );
}
