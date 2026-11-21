import Link from "next/link";
import { getCurrentEmployee } from "@/lib/dal";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/sales-orders", label: "Sales orders" },
  { href: "/employees", label: "Employees" },
];

/** Every page in (app) is protected: the DAL check runs on each request before anything renders. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getCurrentEmployee();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-md bg-brand text-white" aria-hidden>A</span>
            A-ERP
          </Link>
          <nav className="flex gap-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-muted hover:bg-background hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium">{me.first_name} {me.last_name}</div>
              <div className="text-xs text-muted">{me.employee_code} · {me.job_title}</div>
            </div>
            <form action="/auth/signout" method="post">
              <button className="h-9 rounded-md border border-line px-3 text-sm hover:bg-background">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
