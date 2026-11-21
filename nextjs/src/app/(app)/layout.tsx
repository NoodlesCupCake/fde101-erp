import Link from "next/link";
import { ViewTransition } from "react";
import { AppNav, type NavItem } from "@/components/app-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentEmployee } from "@/lib/dal";

/** Every page in (app) is protected: the DAL check runs on each request before anything renders. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getCurrentEmployee();
  const approves = ["leave.approve_team", "leave.approve_any", "leave.approve_own_if_top"].some((p) => me.permissions.includes(p as never));
  const main: NavItem[] = [
    { href: "/", label: "Dashboard" },
    { href: "/leave", label: "Leave" },
    ...(approves ? [{ href: "/leave/approvals", label: "Approvals" }] : []),
    { href: "/sales-orders", label: "Sales orders" },
    { href: "/employees", label: "Employees" },
  ];
  const more: NavItem[] = [
    { href: "/profile", label: "My profile" },
    ...(me.permissions.includes("users.manage") ? [{ href: "/admin/users", label: "Admin: users" }] : []),
    { href: "/permissions", label: "Permissions" },
  ];
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-md bg-brand text-white" aria-hidden>A</span>
            <span className="hidden sm:inline">A-ERP</span>
          </Link>
          <AppNav main={main} more={more} />
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/profile" className="hidden text-right leading-tight md:block" title="My profile">
              <div className="text-sm font-medium">{me.first_name} {me.last_name.charAt(0)}.</div>
              <div className="text-xs text-muted">{me.employee_code}</div>
            </Link>
            <ThemeToggle />
            <form action="/auth/signout" method="post">
              <button className="h-9 whitespace-nowrap rounded-md border border-line px-3 text-sm hover:bg-background">Sign out</button>
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
