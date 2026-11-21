import Link from "next/link";
import { ViewTransition } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { TypeBadges } from "@/components/type-badges";
import { getCurrentEmployee } from "@/lib/dal";

/** Every page in (app) is protected: the DAL check runs on each request before anything renders. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getCurrentEmployee();
  const nav = [
    { href: "/", label: "Dashboard" },
    { href: "/profile", label: "My profile" },
    { href: "/leave", label: "Leave" },
    ...(["leave.approve_team", "leave.approve_any", "leave.approve_own_if_top"].some((p) => me.permissions.includes(p as never))
      ? [{ href: "/leave/approvals", label: "Approvals" }] : []),
    { href: "/sales-orders", label: "Sales orders" },
    { href: "/employees", label: "Employees" },
    { href: "/permissions", label: "Permissions" },
    ...(me.permissions.includes("users.manage") ? [{ href: "/admin/users", label: "Admin" }] : []),
  ];
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-md bg-brand text-white" aria-hidden>A</span>
            A-ERP
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-muted hover:bg-background hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/profile" className="text-right leading-tight">
              <div className="text-sm font-medium">{me.first_name} {me.last_name}</div>
              <div className="text-xs text-muted">{me.employee_code} · <TypeBadges types={me.types} /></div>
            </Link>
            <ThemeToggle />
            <form action="/auth/signout" method="post">
              <button className="h-9 rounded-md border border-line px-3 text-sm hover:bg-background">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {/* Only the page content fades on navigation; the header never moves. Filter/search updates don't animate. */}
      <main className="mx-auto max-w-6xl px-4 py-6">
        <ViewTransition default={{ filter: "none", default: "page" }}>{children}</ViewTransition>
      </main>
    </div>
  );
}
