import { BookOpen, Boxes, CalendarDays, LayoutDashboard, Menu, ShoppingCart, Truck, Users, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useMeta } from "../lib/api";
import { ErrorBoundary } from "./ErrorBoundary";
import { UserMenu } from "./UserMenu";
import { date } from "../lib/format";
import { cx } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/sales-orders", label: "Sales Orders", icon: ShoppingCart },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/receivables", label: "Receivables", icon: Wallet },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/purchase-orders", label: "Purchasing", icon: Truck },
  { to: "/accounting", label: "Accounting", icon: BookOpen },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-2">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} onClick={onNavigate}
          className={({ isActive }) => cx(
            "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors duration-150",
            isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}>
          <Icon className="size-4 shrink-0" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2 border-b px-4">
      <div className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground" aria-hidden>A</div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">A-ERP</div>
        <div className="text-[11px] text-muted-foreground">Prototype</div>
      </div>
    </div>
  );
}

export function Layout() {
  const { data: meta } = useMeta();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0); // braces: newer browsers return a Promise from scrollTo, which useEffect rejects
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-50 rounded bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r bg-card lg:flex">
        <Brand />
        <Nav />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-foreground/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r bg-card">
            <div className="flex items-center justify-between pr-2"><Brand />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation"
                className="inline-flex size-10 items-center justify-center rounded-md hover:bg-muted"><X className="size-5" aria-hidden /></button>
            </div>
            <Nav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-56">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation"
            className="-ml-2 inline-flex size-10 items-center justify-center rounded-md hover:bg-muted lg:hidden">
            <Menu className="size-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium">{meta?.company.name ?? " "}</div>
          {meta && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="hidden rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-medium text-warning sm:inline">Synthetic data</span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap" title="All ageing and YTD figures are calculated as of this date">
                <CalendarDays className="size-3.5" aria-hidden /> As of {date(meta.as_of)}
              </span>
            </div>
          )}
          <UserMenu />
        </header>
        <main id="main" className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
