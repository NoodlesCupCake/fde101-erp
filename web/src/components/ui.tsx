import { AlertTriangle, ArrowLeft, Inbox, Search, type LucideIcon } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { Link } from "react-router";
import { titleCase } from "../lib/format";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-lg border bg-card text-card-foreground", className)}>{children}</section>;
}

export function CardHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </header>
  );
}

export function PageHeader({ title, description, back, actions, badge }: {
  title: ReactNode; description?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode; badge?: ReactNode;
}) {
  return (
    <div className="mb-5 space-y-2">
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-1 rounded text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
            {badge}
          </div>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-accent/10 text-accent",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium", TONES[tone])}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  OPEN: "info", INVOICED: "success", CANCELLED: "neutral", RECEIVED: "success", CLOSED_SHORT: "warning",
  PARTIALLY_RECEIVED: "info", ON_HOLD: "danger", PENDING_APPROVAL: "warning", CONVERTED: "success", REJECTED: "danger",
  AWARDED: "success",
  PAID: "success", PARTIALLY_PAID: "warning",
  ok: "success", low: "warning", out: "danger", at_risk: "danger", dead: "neutral", excess: "warning",
  Current: "success", "1-30": "neutral", "31-60": "warning", "61-90": "warning", "90+": "danger",
};
const STATUS_LABEL: Record<string, string> = { ok: "In stock", low: "Below ROP", out: "Out of stock", at_risk: "At risk", dead: "Slow / dead", excess: "Overstock", CLOSED_SHORT: "Closed short" };

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? (status.includes("-") || status.includes("+") || status === "Current" ? status : titleCase(status))}</Badge>;
}

export function Kpi({ label, value, sub, icon: Icon, tone, to }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: LucideIcon; tone?: "danger" | "warning" | "success"; to?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
      </div>
      <div className="num mt-1 text-lg font-semibold tracking-tight sm:text-xl">{value}</div>
      {sub && (
        <div className={cx("num mt-0.5 text-xs", tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-muted-foreground")}>
          {sub}
        </div>
      )}
    </>
  );
  const cls = "block h-full min-w-0 rounded-lg border bg-card p-3 sm:p-4";
  return to ? (
    <Link to={to} className={cx(cls, "transition-colors duration-150 hover:border-accent/50 hover:bg-muted/40")}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground", className)}>
      {label}
      {children}
    </label>
  );
}

const inputCls =
  "h-9 w-full rounded-md border bg-card px-2.5 text-sm text-foreground transition-colors duration-150 hover:border-muted-foreground/40 focus-visible:outline-2 focus-visible:outline-ring";

export function SearchInput({ value, onChange, placeholder, label = "Search" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label?: string;
}) {
  return (
    <Field label={label} className="min-w-56 flex-1">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input type="search" defaultValue={value} placeholder={placeholder} className={cx(inputCls, "pl-8")}
          onChange={(e) => debounce(() => onChange(e.target.value))} />
      </div>
    </Field>
  );
}

let timer: ReturnType<typeof setTimeout> | undefined;
function debounce(fn: () => void, ms = 250) {
  clearTimeout(timer);
  timer = setTimeout(fn, ms);
}

export function Select({ label, options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string; options: { value: string | number; label: string }[];
}) {
  return (
    <Field label={label} className="w-full sm:w-44">
      <select {...props} className={inputCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} className="w-full sm:w-40">
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </Field>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>;
}

export function Tabs({ tabs, value, onChange }: { tabs: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div role="tablist" className="mb-4 inline-flex rounded-md border bg-card p-0.5">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx("h-8 rounded px-3 text-sm font-medium transition-colors duration-150",
            value === t.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function DefinitionList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 text-right font-medium break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded bg-muted", className)} aria-hidden />;
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      <Skeleton className="h-7 w-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div>
        <p className="font-medium text-destructive">Couldn't load data</p>
        <p className="text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
      </div>
    </div>
  );
}

export function EmptyState({ message = "No records match these filters." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-sm text-muted-foreground">
      <Inbox className="size-6" aria-hidden />
      {message}
    </div>
  );
}
