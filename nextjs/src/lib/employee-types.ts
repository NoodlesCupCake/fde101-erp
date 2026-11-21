import "server-only";
import type { UserType } from "./dal";
import type { createClient } from "./supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/** User types + manager names for one page of employees (3 small queries, independent of page depth). */
export async function typesForPage(supabase: Client, ids: number[], managerIds: number[]) {
  const [subs, roles, mgrs] = await Promise.all([
    supabase.from("employees").select("manager_id").in("manager_id", ids).eq("is_active", true),
    supabase.from("employee_roles").select("employee_id, role").in("employee_id", ids),
    supabase.from("employees").select("employee_id, first_name, last_name").in("employee_id", managerIds),
  ]);
  const isManager = new Set((subs.data ?? []).map((r) => r.manager_id as number));
  const stored = (roles.data ?? []) as { employee_id: number; role: "hr" | "admin" }[];
  const managerName = new Map((mgrs.data ?? []).map((m) => [m.employee_id as number, `${m.first_name} ${m.last_name}`]));
  const typesOf = (id: number): UserType[] => [
    "employee",
    ...(isManager.has(id) ? (["manager"] as const) : []),
    ...stored.filter((r) => r.employee_id === id).map((r) => r.role).sort(),
  ];
  return { typesOf, managerName };
}
