import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { InfiniteRows } from "@/components/infinite-rows";
import { employeeFilterFields, parseEmployeeFilters, rawEmployeeFilters } from "@/lib/employee-filters";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/dal";
import { adminUsersPage } from "./data";
import { loadAdminUsers } from "./load-more";
import { Flash } from "./shared";

export default async function AdminUsers({ searchParams }: PageProps<"/admin/users">) {
  const me = await requirePermission("users.manage");
  const sp = await searchParams;
  const f = parseEmployeeFilters(sp);
  const raw = rawEmployeeFilters(f);
  const supabase = await createClient();
  const [{ rows, next }, depts] = await Promise.all([
    adminUsersPage(me, f),
    supabase.from("departments").select("department_id, code, name").order("code"),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Users &amp; types</h1>
          <p className="text-sm text-muted">Manager comes from the reporting line. HR and Admin are granted here. Click an employee to edit.</p>
        </div>
        <Link href="/admin/users/new" className="h-9 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90">+ New employee</Link>
      </div>
      <Flash sp={sp} />
      <FilterBar fields={employeeFilterFields(depts.data ?? [])} />
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Employee</th><th className="px-4 py-2 font-medium">Types</th>
              <th className="px-4 py-2 font-medium">Quick type change</th><th className="px-4 py-2 font-medium">Login</th>
            </tr>
          </thead>
          <tbody>
            {rows}
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">No employees match these filters.</td></tr>}
            <InfiniteRows key={JSON.stringify(raw)} next={next} load={loadAdminUsers.bind(null, raw)} colSpan={4} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
