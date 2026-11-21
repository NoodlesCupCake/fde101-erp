import { TypeBadges } from "@/components/type-badges";
import { getCurrentEmployee } from "@/lib/dal";
import { date, thb } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Report = { employee_id: number; employee_code: string; first_name: string; last_name: string; job_title: string };

export default async function Profile() {
  const me = await getCurrentEmployee();
  const supabase = await createClient();
  const { data: team } = me.types.includes("manager")
    ? await supabase
        .from("employees")
        .select("employee_id, employee_code, first_name, last_name, job_title")
        .eq("manager_id", me.employee_id)
        .eq("is_active", true)
        .order("employee_code")
        .returns<Report[]>()
    : { data: [] as Report[] };

  const rows: [string, React.ReactNode][] = [
    ["Employee code", me.employee_code],
    ["User type(s)", <TypeBadges key="t" types={me.types} />],
    ["Reporting manager", me.manager_name ? `${me.manager_name} (${me.manager_code}) · ${me.manager_title}` : "None: top of the organization"],
    ["Department", `${me.department} (${me.department_code})`],
    ["Job title", me.job_title],
    ["Email", me.email],
    ["Hired", date(me.hire_date)],
    ["Monthly salary", <span key="s">{thb(me.monthly_salary)} <span className="text-xs text-muted">· only you and HR can see this</span></span>],
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-surface p-5">
        <h1 className="text-xl font-semibold">{me.first_name} {me.last_name}</h1>
        <dl className="mt-4 divide-y divide-line text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[180px_1fr]">
              <dt className="text-muted">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {me.types.includes("manager") && (
        <section className="rounded-xl border border-line bg-surface">
          <h2 className="border-b border-line px-5 py-3 font-semibold">My team ({team?.length ?? 0})</h2>
          <ul className="divide-y divide-line text-sm">
            {(team ?? []).map((r) => (
              <li key={r.employee_id} className="flex justify-between px-5 py-2">
                <span>{r.first_name} {r.last_name} <span className="font-mono text-xs text-muted">{r.employee_code}</span></span>
                <span className="text-muted">{r.job_title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
