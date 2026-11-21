import Link from "next/link";
import { requirePermission } from "@/lib/dal";
import { createEmployee } from "../actions";
import { EmployeeFieldset, Flash } from "../shared";

export default async function NewEmployee({ searchParams }: PageProps<"/admin/users/new">) {
  await requirePermission("users.manage");
  const sp = await searchParams;
  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/admin/users" className="text-sm text-brand hover:underline">← Users &amp; types</Link>
      <h1 className="text-xl font-semibold">New employee</h1>
      <p className="text-sm text-muted">
        The employee code is assigned automatically. With a password, they get a login right away. Without one,
        they can register themselves on /login with their employee code (a confirmation link goes to this email).
      </p>
      <Flash sp={sp} />
      <form action={createEmployee} className="space-y-4 rounded-xl border border-line bg-surface p-5">
        <input type="hidden" name="back" value="/admin/users/new" />
        <EmployeeFieldset isNew />
        <button className="h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90">Create employee</button>
      </form>
    </div>
  );
}
