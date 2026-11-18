import { CheckCircle2, XCircle } from "lucide-react";
import { Link, useParams } from "react-router";
import { DataTable, Pagination } from "../components/DataTable";
import { Badge, Card, CardHeader, cx, DateInput, ErrorState, FilterBar, PageHeader, PageSkeleton, Select, Tabs } from "../components/ui";
import { useApi, useUrlState, type Paged } from "../lib/api";
import { date, money, monthName, thousands, titleCase } from "../lib/format";

interface TbAccount { account_code: string; name: string; account_type: string; normal_balance: string; debit: number; credit: number; balance: number }
interface Tb { as_of: string; accounts: TbAccount[]; total_debit: number; total_credit: number }
interface IsAccount { account_code: string; name: string; account_type: string; months: Record<string, number>; total: number }
interface Is { year: number; years: number[]; months: string[]; accounts: IsAccount[] }

const TYPE_TONE = { ASSET: "info", LIABILITY: "warning", EQUITY: "neutral", REVENUE: "success", EXPENSE: "danger" } as const;

export function AccountingPage() {
  const [f, set] = useUrlState({ tab: "tb", as_of_date: "", year: "" });
  return (
    <>
      <PageHeader title="Accounting" description="General ledger: every operational event posts a balanced double-entry journal." />
      <Tabs value={f.tab} onChange={(tab) => set({ tab })} tabs={[{ value: "tb", label: "Trial balance" }, { value: "is", label: "Income statement" }]} />
      {f.tab === "tb" ? <TrialBalance asOf={f.as_of_date} onAsOf={(as_of_date) => set({ as_of_date })} />
        : <IncomeStatement year={f.year} onYear={(year) => set({ year })} />}
    </>
  );
}

function TrialBalance({ asOf, onAsOf }: { asOf: string; onAsOf: (v: string) => void }) {
  const { data, error, isLoading, isFetching } = useApi<Tb>("gl/trial-balance", { as_of_date: asOf });
  if (error) return <ErrorState error={error} />;
  const balanced = data && Math.abs(data.total_debit - data.total_credit) < 0.01;
  return (
    <>
      <FilterBar>
        <DateInput label="As of date" value={asOf || data?.as_of || ""} onChange={onAsOf} />
        {data && (
          <p className={cx("flex h-9 items-center gap-1.5 text-sm font-medium", balanced ? "text-success" : "text-destructive")}>
            {balanced ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
            {balanced ? "Debits equal credits" : "Out of balance"}
          </p>
        )}
      </FilterBar>
      <Card>
        <DataTable caption="Trial balance" rows={data?.accounts} loading={isLoading} fetching={isFetching}
          rowKey={(a) => a.account_code} rowHref={(a) => `/accounting/accounts/${a.account_code}`}
          columns={[
            { key: "account_code", header: "Account", render: (a) => <span className="font-mono">{a.account_code}</span> },
            { key: "name", header: "Name", className: "min-w-56" },
            { key: "account_type", header: "Type", render: (a) => <Badge tone={TYPE_TONE[a.account_type as keyof typeof TYPE_TONE]}>{titleCase(a.account_type)}</Badge> },
            { key: "debit", header: "Total debits", align: "right", render: (a) => money(a.debit) },
            { key: "credit", header: "Total credits", align: "right", render: (a) => money(a.credit) },
            { key: "balance", header: "Balance (THB)", align: "right", render: (a) => <span className={cx("font-medium", a.balance < 0 && "text-destructive")}>{money(a.balance)}</span> },
          ]}
          footer={data && (
            <tr><td colSpan={3} className="px-3 py-2">Total</td>
              <td className="num px-3 py-2 text-right">{money(data.total_debit)}</td>
              <td className="num px-3 py-2 text-right">{money(data.total_credit)}</td><td /></tr>
          )} />
      </Card>
    </>
  );
}

function IncomeStatement({ year, onYear }: { year: string; onYear: (v: string) => void }) {
  const { data, error, isLoading, isFetching } = useApi<Is>("gl/income-statement", { year });
  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <PageSkeleton />;
  const { months, accounts } = data;
  const by = (pred: (a: IsAccount) => boolean) => accounts.filter(pred);
  const revenue = by((a) => a.account_type === "REVENUE");
  const cogs = by((a) => a.account_code.startsWith("5"));
  const opex = by((a) => a.account_code.startsWith("6"));
  const sum = (rows: IsAccount[], m?: string) => rows.reduce((t, a) => t + (m ? a.months[m] ?? 0 : a.total), 0);
  const cell = "num px-2.5 py-1.5 text-right whitespace-nowrap";
  const Row = ({ label, value, strong, indent, code }: { label: string; value: (m?: string) => number; strong?: boolean; indent?: boolean; code?: string }) => (
    <tr className={cx("border-b last:border-0", strong && "bg-muted/40 font-semibold")}>
      <th scope="row" className={cx("sticky left-0 z-10 px-3 py-1.5 text-left font-normal whitespace-nowrap", strong ? "bg-muted font-semibold" : "bg-card", indent && "pl-6")}>
        {code ? <Link to={`/accounting/accounts/${code}`} className="hover:text-accent hover:underline"><span className="font-mono text-xs text-muted-foreground">{code}</span> {label}</Link> : label}
      </th>
      {months.map((m) => <td key={m} className={cx(cell, value(m) < 0 && "text-muted-foreground")}>{thousands(value(m))}</td>)}
      <td className={cx(cell, "font-semibold")}>{thousands(value())}</td>
    </tr>
  );
  const gp = (m?: string) => sum(revenue, m) - sum(cogs, m);
  const np = (m?: string) => gp(m) - sum(opex, m);
  return (
    <>
      <FilterBar>
        <Select label="Fiscal year" value={year || String(data.year)} onChange={(e) => onYear(e.target.value)}
          options={data.years.map((y) => ({ value: y, label: String(y) }))} />
        <p className="flex h-9 items-center text-sm text-muted-foreground">
          Gross margin <span className="num ml-1 font-semibold text-foreground">{((gp() / sum(revenue)) * 100).toFixed(1)}%</span>
          <span className="mx-2">·</span> Net margin <span className="num ml-1 font-semibold text-foreground">{((np() / sum(revenue)) * 100).toFixed(1)}%</span>
        </p>
      </FilterBar>
      <Card>
        <CardHeader title={`Income statement ${data.year}`} description="Monthly, THB thousands; costs shown in parentheses. Operating profit before tax." />
        <div className={cx("overflow-x-auto transition-opacity duration-150", isFetching && "opacity-60")}>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Monthly income statement</caption>
            <thead className="bg-muted/60">
              <tr className="border-b">
                <th scope="col" className="sticky left-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Account</th>
                {months.map((m) => <th key={m} scope="col" className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{monthName(m)}</th>)}
                <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {revenue.map((a) => <Row key={a.account_code} code={a.account_code} label={a.name} indent value={(m) => (m ? a.months[m] ?? 0 : a.total)} />)}
              {cogs.map((a) => <Row key={a.account_code} code={a.account_code} label={a.name} indent value={(m) => -(m ? a.months[m] ?? 0 : a.total)} />)}
              <Row label="Gross profit" strong value={gp} />
              {opex.map((a) => <Row key={a.account_code} code={a.account_code} label={a.name} indent value={(m) => -(m ? a.months[m] ?? 0 : a.total)} />)}
              <Row label="Operating profit" strong value={np} />
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

interface LedgerLine {
  journal_line_id: number; journal_entry_id: number; entry_number: string; entry_date: string; source_type: string;
  description: string; debit: number; credit: number; running_balance: number;
}

export function AccountLedgerPage() {
  const { code } = useParams();
  const [f, set] = useUrlState({ date_from: "", date_to: "", source_type: "", dir: "desc", page: "1" });
  const { data, error, isLoading, isFetching } = useApi<Paged<LedgerLine> & { account: TbAccount; source_types: string[] }>(
    `gl/accounts/${code}/lines`, { ...f, page_size: 50 });
  if (error) return <ErrorState error={error} />;
  return (
    <>
      <PageHeader back={{ to: "/accounting", label: "Accounting" }}
        title={data ? <><span className="font-mono">{data.account.account_code}</span> {data.account.name}</> : `Account ${code}`}
        badge={data && <Badge tone={TYPE_TONE[data.account.account_type as keyof typeof TYPE_TONE]}>{titleCase(data.account.account_type)}</Badge>}
        description="Account ledger with running balance (in the account's normal-balance direction)." />
      <FilterBar>
        <DateInput label="From" value={f.date_from} onChange={(date_from) => set({ date_from })} />
        <DateInput label="To" value={f.date_to} onChange={(date_to) => set({ date_to })} />
        <Select label="Source" value={f.source_type} onChange={(e) => set({ source_type: e.target.value })}
          options={[{ value: "", label: "All sources" }, ...(data?.source_types ?? []).map((s) => ({ value: s, label: titleCase(s) }))]} />
      </FilterBar>
      {f.source_type && <p className="mb-2 text-xs text-muted-foreground">Running balance covers only the filtered lines.</p>}
      <Card>
        <DataTable caption="Account ledger lines" rows={data?.items} loading={isLoading} fetching={isFetching}
          rowKey={(r) => r.journal_line_id} sort="entry_date" dir={f.dir} onSort={(_, dir) => set({ dir })}
          columns={[
            { key: "entry_date", header: "Date", sortable: true, render: (r) => <span className="whitespace-nowrap">{date(r.entry_date)}</span> },
            { key: "entry_number", header: "Entry #", render: (r) => <span className="font-mono text-xs">{r.entry_number}</span> },
            { key: "source_type", header: "Source", render: (r) => <span className="whitespace-nowrap">{titleCase(r.source_type)}</span> },
            { key: "description", header: "Description", className: "min-w-64" },
            { key: "debit", header: "Debit", align: "right", render: (r) => (r.debit ? money(r.debit) : "") },
            { key: "credit", header: "Credit", align: "right", render: (r) => (r.credit ? money(r.credit) : "") },
            { key: "running_balance", header: "Balance", align: "right", render: (r) => <span className="font-medium">{money(r.running_balance)}</span> },
          ]} />
        {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => set({ page: p })} />}
      </Card>
    </>
  );
}
