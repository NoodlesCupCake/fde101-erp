import Link from "next/link";
import { ViewTransition } from "react";
import { AccountSwitcher } from "@/components/account-switcher";
import { Sidebar, type NavGroup } from "@/components/app-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentEmployee } from "@/lib/dal";

/** Every page in (app) is protected: the DAL check runs on each request before anything renders. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getCurrentEmployee();
  const approves = ["leave.approve_team", "leave.approve_any", "leave.approve_own_if_top"].some((p) => me.permissions.includes(p as never));
  const groups: NavGroup[] = [
    { items: [
      { href: "/", label: "Dashboard", icon: "◧" },
      { href: "/profile", label: "My profile", icon: "☺" },
    ] },
    { title: "Leave", items: [
      { href: "/leave", label: "My leave", icon: "✈" },
      ...(approves ? [{ href: "/leave/approvals", label: "Approvals", icon: "✓" }] : []),
    ] },
    { title: "Data", items: [
      { href: "/sales-orders", label: "Sales orders", icon: "▤" },
      { href: "/employees", label: "Employees", icon: "☷" },
    ] },
    { title: "Access", items: [
      ...(me.permissions.includes("users.manage") ? [{ href: "/admin/users", label: "Users", icon: "⚙" }] : []),
      { href: "/permissions", label: "Permissions", icon: "🔒" },
    ] },
  ];

  const footer = (
    <div className="space-y-2">
      <Link href="/profile" className="block rounded-md px-2 py-1.5 leading-tight hover:bg-background">
        <div className="truncate text-sm font-medium">{me.first_name} {me.last_name}</div>
        <div className="truncate text-xs text-muted">{me.employee_code} · {me.job_title}</div>
      </Link>
      <div className="flex items-center gap-2">
        {process.env.DEMO_PASSWORD && <AccountSwitcher current={me.employee_code} />}
        <ThemeToggle />
        <form action="/auth/signout" method="post" className="ml-auto">
          <button className="h-9 whitespace-nowrap rounded-md border border-line px-3 text-sm hover:bg-background">Sign out</button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh md:flex">
      <Sidebar groups={groups} footer={footer} />
      {/* Only the page content fades on navigation; the sidebar never moves. Filter/search updates don't animate. */}
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-6xl">
          <ViewTransition default={{ filter: "none", default: "page" }}>{children}</ViewTransition>
        </div>
      </main>
    </div>
  );
}
