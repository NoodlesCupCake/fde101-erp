import { TypeBadges } from "@/components/type-badges";
import { getCurrentEmployee } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { setPermission } from "./actions";

const ROLES = ["employee", "manager", "hr", "admin"] as const;
const LABEL: Record<(typeof ROLES)[number], string> = { employee: "Employee", manager: "Manager", hr: "HR", admin: "Admin" };

/** Each permission, what it means, and where the database enforces it. */
const PERMISSIONS: { key: string; action: string; where: string; later?: boolean }[] = [
  { key: "salary.read_own", action: "See own salary", where: "current_employee(), visible_salaries()" },
  { key: "salary.read_all", action: "See other people's salary", where: "visible_salaries(); no column privilege on employees.monthly_salary for anyone" },
  { key: "users.manage", action: "Create / update / terminate users and their logins", where: "admin_*_employee() functions; Admin API only after the same check" },
  { key: "types.manage", action: "Change a user's type (HR / Admin)", where: "RLS on employee_roles (insert/delete)" },
  { key: "permissions.manage", action: "Edit this matrix", where: "RLS on role_permissions; Admin always keeps it" },
  { key: "stock.view", action: "See the stock dashboard", where: "can_view_stock() in every stock function + RLS on inventory tables. Warehouse, Purchasing and Finance staff always can" },
  { key: "leave.request", action: "Make a leave request", where: "submit_leave()" },
  { key: "leave.approve_team", action: "Approve direct reports' leave (manager_id = you)", where: "can_decide_leave() inside decide_leave(); RLS shows your team's requests" },
  { key: "leave.approve_own_if_top", action: "Approve own leave if they have no superior", where: "can_decide_leave(): own request only when manager_id is null (E0001)" },
  { key: "leave.approve_any", action: "Approve any leave request, except your own", where: "can_decide_leave(); RLS shows all requests; also manages public_holidays" },
];

export default async function Permissions({ searchParams }: PageProps<"/permissions">) {
  const me = await getCurrentEmployee();
  const sp = await searchParams;
  const canEdit = me.permissions.includes("permissions.manage");
  const supabase = await createClient();
  const { data } = await supabase.from("role_permissions").select("role, permission, allowed");
  const allowed = new Set((data ?? []).filter((r) => r.allowed).map((r) => `${r.role}:${r.permission}`));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Permissions</h1>
        <p className="text-sm text-muted">
          This matrix is stored in the database (<code>role_permissions</code>), and every rule is enforced there, not by hiding
          buttons. Types stack: someone who is Manager + HR gets both columns. You are <TypeBadges types={me.types} />
          {canEdit ? " and can edit it: click a cell to flip it. It takes effect on the next request." : ". Only types with permissions.manage can edit it."}
        </p>
      </div>
      {typeof sp.ok === "string" && <p role="status" className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">{sp.ok}</p>}
      {typeof sp.error === "string" && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{sp.error}</p>}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Action</th>
              {ROLES.map((r) => <th key={r} className="px-4 py-2 text-center font-medium">{LABEL[r]}</th>)}
              <th className="px-4 py-2 font-medium">Enforced by</th>
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p.key} className="border-t border-line">
                <td className="px-4 py-2">
                  <div className="font-medium">{p.action}</div>
                  <div className="font-mono text-xs text-muted">{p.key}</div>
                </td>
                {ROLES.map((role) => {
                  const on = allowed.has(`${role}:${p.key}`);
                  const locked = role === "admin" && p.key === "permissions.manage";
                  const cell = on ? <span className="font-medium text-ok">✓ Can</span> : <span className="text-danger">✗ Cannot</span>;
                  return (
                    <td key={role} className="px-2 py-1.5 text-center">
                      {canEdit && !locked ? (
                        <form action={setPermission}>
                          <input type="hidden" name="role" value={role} />
                          <input type="hidden" name="permission" value={p.key} />
                          <input type="hidden" name="allowed" value={on ? "0" : "1"} />
                          <button title={`${on ? "Revoke" : "Grant"} ${p.key} for ${LABEL[role]}`}
                            className="w-full rounded-md px-2 py-1.5 transition hover:bg-background">{cell}</button>
                        </form>
                      ) : (
                        <span title={locked ? "Locked so nobody gets locked out" : undefined}>{cell}{locked && " 🔒"}</span>
                      )}
                    </td>
                  );
                })}
                <td className={`px-4 py-2 text-xs ${p.later ? "text-brand" : "text-muted"}`}>{p.later ? "Workshop 1.5 (saved, not enforced yet)" : p.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
