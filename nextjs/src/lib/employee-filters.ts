import "server-only";
import { id, one, oneOf, searchTerm } from "./filters";

export type EmployeeFilters = { q: string; dept: number | null; status: "" | "active" | "left" };

export function parseEmployeeFilters(sp: Record<string, string | string[] | undefined>): EmployeeFilters {
  return { q: searchTerm(one(sp, "q")), dept: id(one(sp, "dept")), status: oneOf(one(sp, "status"), ["active", "left"] as const) };
}

export const rawEmployeeFilters = (f: EmployeeFilters) => ({ q: f.q, dept: f.dept ? String(f.dept) : "", status: f.status });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyEmployeeFilters(q: any, f: EmployeeFilters) {
  if (f.dept) q = q.eq("department_id", f.dept);
  if (f.status === "active") q = q.eq("is_active", true).is("termination_date", null);
  if (f.status === "left") q = q.eq("is_active", false);
  if (f.q) {
    const t = `*${f.q}*`;
    q = q.or(["first_name", "last_name", "employee_code", "email", "job_title"].map((c) => `${c}.ilike.${t}`).join(","));
  }
  return q;
}

export const employeeFilterFields = (depts: { department_id: number; code: string; name: string }[]) => [
  { name: "q", type: "search" as const, placeholder: "Name, code, email or job title…" },
  { name: "dept", type: "select" as const, label: "Department", options: depts.map((d) => ({ value: String(d.department_id), label: `${d.code} · ${d.name}` })) },
  { name: "status", type: "select" as const, label: "Status", options: [{ value: "active", label: "Active" }, { value: "left", label: "Left" }] },
];
