import { InfiniteRows } from "@/components/infinite-rows";
import { getCurrentEmployee } from "@/lib/dal";
import { loadEmployees } from "./actions";
import { employeesPage } from "./data";

/** Directory. Salaries only appear for HR: the database never sends them to anyone else. */
export default async function Employees() {
  const me = await getCurrentEmployee();
  const { rows, next, isHR } = await employeesPage(me);
  const cols = isHR ? 8 : 7;

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
            {rows}
            <InfiniteRows next={next} load={loadEmployees} colSpan={cols} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
