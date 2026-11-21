import { TypeBadges } from "@/components/type-badges";
import { getCurrentEmployee } from "@/lib/dal";

type Cell = "yes" | "no" | string;
const ROWS: { action: string; cells: [Cell, Cell, Cell, Cell]; where: string }[] = [
  { action: "See own salary", cells: ["yes", "yes", "yes", "yes"], where: "current_employee() / visible_salaries() return only your own row" },
  { action: "See other people's salary", cells: ["no", "no", "yes", "no"], where: "No column privilege on employees.monthly_salary; visible_salaries() returns everyone only if has_role('hr')" },
  { action: "Read the employee directory", cells: ["yes", "yes", "yes", "yes"], where: "RLS: active employees only (current_employee_id() is not null)" },
  { action: "Create / update / terminate employees", cells: ["no", "no", "no", "yes"], where: "admin_create/update/terminate_employee() raise 'Admins only' unless has_role('admin')" },
  { action: "Create / reset / delete login accounts", cells: ["no", "no", "no", "yes"], where: "Supabase Admin API, only from Server Actions after requireType('admin'). auth.users trigger still blocks non-employees" },
  { action: "Change a user's type (HR / Admin)", cells: ["no", "no", "no", "yes"], where: "RLS on employee_roles: insert/delete only if has_role('admin'); the last admin can't be removed" },
  { action: "Make a leave request", cells: ["yes", "yes", "yes", "yes"], where: "Workshop 1.5" },
  { action: "Approve own leave request", cells: ["no", "only if no superior", "yes (any)", "no"], where: "Workshop 1.5" },
  { action: "Approve subordinates' leave", cells: ["no", "yes", "yes (any)", "no"], where: "Workshop 1.5" },
];
const COLS = ["Employee", "Manager", "HR", "Admin"];

function Mark({ v }: { v: Cell }) {
  if (v === "yes") return <span className="font-medium text-ok">✓ Can</span>;
  if (v === "no") return <span className="text-danger">✗ Cannot</span>;
  return <span className="text-brand">{v}</span>;
}

/** Role × action matrix. Types stack: a Manager who is also HR gets both columns' "Can"s. */
export default async function Permissions() {
  const me = await getCurrentEmployee();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Permissions</h1>
        <p className="text-sm text-muted">
          Hiding a button is not a permission: every &quot;Cannot&quot; is enforced in the database (RLS, column privileges,
          or a function that checks the caller). Types stack, so someone who is Manager + HR can do both. You are: <TypeBadges types={me.types} />
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Action</th>
              {COLS.map((c) => <th key={c} className="px-4 py-2 font-medium">{c}</th>)}
              <th className="px-4 py-2 font-medium">Enforced by</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.action} className={`border-t border-line ${r.where === "Workshop 1.5" ? "opacity-60" : ""}`}>
                <td className="px-4 py-2 font-medium">{r.action}</td>
                {r.cells.map((c, i) => <td key={i} className="whitespace-nowrap px-4 py-2"><Mark v={c} /></td>)}
                <td className="px-4 py-2 text-xs text-muted">{r.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Leave rules are planned for Workshop 1.5 and aren&apos;t built yet.</p>
    </div>
  );
}
