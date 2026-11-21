import { FilterBar } from "@/components/filter-bar";
import { InfiniteRows } from "@/components/infinite-rows";
import { employeeFilterFields, parseEmployeeFilters, rawEmployeeFilters } from "@/lib/employee-filters";
import { createClient } from "@/lib/supabase/server";
import { getCurrentEmployee } from "@/lib/dal";
import { loadEmployees } from "./actions";
import { employeesPage } from "./data";

/** Directory. Salaries only appear for HR: the database never sends them to anyone else. */
export default async function Employees({ searchParams }: PageProps<"/employees">) {
  const me = await getCurrentEmployee();
  const f = parseEmployeeFilters(await searchParams);
  const supabase = await createClient();
  const [{ rows, next, isHR }, depts] = await Promise.all([
    employeesPage(me, f),
    supabase.from("departments").select("department_id, code, name").order("code"),
  ]);
  const raw = rawEmployeeFilters(f);
  const cols = isHR ? 8 : 7;

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="space-y-3 border-b border-line px-5 py-3">
        <h1 className="font-semibold">Employees</h1>
        <FilterBar fields={employeeFilterFields(depts.data ?? [])} />
        <p className="text-sm text-muted">{isHR ? "You have salary.read_all, so you can see salaries." : "Salaries are visible only to types with salary.read_all (HR by default)."}</p>
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
            {rows}
            {rows.length === 0 && <tr><td colSpan={cols} className="px-5 py-8 text-center text-muted">No employees match these filters.</td></tr>}
            <InfiniteRows key={JSON.stringify(raw)} next={next} load={loadEmployees.bind(null, raw)} colSpan={cols} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
