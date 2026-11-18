import type { ReactNode } from "react";
import { useParams } from "react-router";
import { DataTable, Pagination } from "../components/DataTable";
import { DocumentFlow, JournalEntries } from "../components/Documents";
import { Card, CardHeader, cx, DefinitionList, ErrorState, FilterBar, PageHeader, PageSkeleton, SearchInput, Select, StatusBadge } from "../components/ui";
import { useApi, useMeta, useUrlState, type JournalEntry, type Paged } from "../lib/api";
import { baht, date, money, num } from "../lib/format";

interface PoRow {
  purchase_order_id: number; po_number: string; order_date: string; expected_date: string; status: string; supplier_name: string;
  warehouse: string; total_amount: number; receipt_date: string | null; line_count: number; days_late: number | null;
}

export function PurchaseOrdersPage() {
  const { data: meta } = useMeta();
  const [f, set] = useUrlState({ q: "", status: "", supplier_id: "", warehouse_id: "", sort: "order_date", dir: "desc", page: "1" });
  const { data, error, isLoading, isFetching } = useApi<Paged<PoRow>>("purchase-orders", { ...f, page_size: 25 });

  return (
    <>
      <PageHeader title="Purchase Orders" description="Raised automatically on each supplier's weekly review day when stock position falls below the reorder point." />
      <FilterBar>
        <SearchInput value={f.q} onChange={(q) => set({ q })} placeholder="PO # or supplier" />
        <Select label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}
          options={[{ value: "", label: "All statuses" }, { value: "OPEN", label: "Open" }, { value: "RECEIVED", label: "Received" }, { value: "CLOSED_SHORT", label: "Closed short" }]} />
        <Select label="Supplier" value={f.supplier_id} onChange={(e) => set({ supplier_id: e.target.value })}
          options={[{ value: "", label: "All suppliers" }, ...(meta?.suppliers ?? []).map((s) => ({ value: s.supplier_id, label: s.name }))]} />
        <Select label="Warehouse" value={f.warehouse_id} onChange={(e) => set({ warehouse_id: e.target.value })}
          options={[{ value: "", label: "All warehouses" }, ...(meta?.warehouses ?? []).map((w) => ({ value: w.warehouse_id, label: w.code }))]} />
      </FilterBar>
      {error ? <ErrorState error={error} /> : (
        <Card>
          <DataTable caption="Purchase orders" rows={data?.items} loading={isLoading} fetching={isFetching}
            rowKey={(r) => r.purchase_order_id} rowHref={(r) => `/purchase-orders/${r.purchase_order_id}`}
            sort={f.sort} dir={f.dir} onSort={(sort, dir) => set({ sort, dir })}
            columns={[
              { key: "po_number", header: "PO #", sortable: true, render: (r) => <span className="font-mono">{r.po_number}</span> },
              { key: "order_date", header: "Order date", sortable: true, render: (r) => date(r.order_date) },
              { key: "supplier_name", header: "Supplier", sortable: true, render: (r) => <div className="min-w-56">{r.supplier_name}</div> },
              { key: "warehouse", header: "WH", render: (r) => <span className="font-mono text-xs">{r.warehouse}</span> },
              { key: "line_count", header: "Lines", align: "right", render: (r) => num(r.line_count) },
              { key: "total_amount", header: "Total (THB)", align: "right", sortable: true, render: (r) => money(r.total_amount) },
              { key: "expected_date", header: "Expected", sortable: true, render: (r) => date(r.expected_date) },
              { key: "receipt_date", header: "Received", render: (r) => r.receipt_date ? (
                <span>{date(r.receipt_date)}{r.days_late != null && r.days_late > 0 && <span className="ml-1 text-xs text-warning">+{r.days_late}d</span>}</span>
              ) : "—" },
              { key: "status", header: "Status", sortable: true, render: (r) => <StatusBadge status={r.status} /> },
            ]} />
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => set({ page: p })} />}
        </Card>
      )}
    </>
  );
}

interface PoDetail extends PoRow {
  supplier_code: string; payment_terms_days: number; lead_time_days: number; buyer: string; warehouse_name: string; subtotal: number; vat_amount: number;
  lines: { po_line_id: number; line_no: number; product_id: number; sku: string; product_name: string; uom: string; quantity: number; received_quantity: number; unit_cost: number; line_amount: number }[];
  goods_receipt: { gr_number: string; receipt_date: string; received_by_name: string } | null;
  supplier_invoice: { document_number: string; supplier_invoice_ref: string; invoice_date: string; due_date: string; total_amount: number; status: string } | null;
  payments: { supplier_payment_id: number; payment_number: string; payment_date: string; amount: number; method: string }[];
  journal_entries: JournalEntry[];
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const { data: po, error, isLoading } = useApi<PoDetail>(`purchase-orders/${id}`);
  if (error) return <ErrorState error={error} />;
  if (isLoading || !po) return <PageSkeleton />;
  const gr = po.goods_receipt, si = po.supplier_invoice, pay = po.payments.at(-1);

  return (
    <>
      <PageHeader back={{ to: "/purchase-orders", label: "Purchase orders" }} title={<span className="font-mono">{po.po_number}</span>}
        badge={<StatusBadge status={po.status} />} description={`${po.supplier_name} · ordered ${date(po.order_date)}`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <DocumentFlow steps={[
            { label: "Purchase order", number: po.po_number, date: po.order_date, detail: `Expected ${date(po.expected_date)}`, done: true },
            { label: "Goods receipt", number: gr?.gr_number, date: gr?.receipt_date, done: !!gr },
            { label: "Supplier invoice", number: si?.document_number, date: si?.invoice_date, detail: si ? `Due ${date(si.due_date)}` : undefined, done: !!si },
            { label: "Payment", number: pay?.payment_number, date: pay?.payment_date, done: si?.status === "PAID" },
          ]} />
          <Card>
            <CardHeader title="Lines" description="Short receipts close the line; the shortfall is re-ordered on the next review." />
            <DataTable caption="Purchase order lines" rows={po.lines} rowKey={(l) => l.po_line_id} rowHref={(l) => `/inventory/products/${l.product_id}`}
              columns={[
                { key: "sku", header: "SKU", render: (l) => <span className="font-mono text-xs">{l.sku}</span> },
                { key: "product_name", header: "Product", className: "min-w-56" },
                { key: "quantity", header: "Ordered", align: "right", render: (l) => `${num(l.quantity)} ${l.uom}` },
                { key: "received_quantity", header: "Received", align: "right", render: (l) => (
                  <span className={cx(gr && l.received_quantity < l.quantity && "font-medium text-warning")}>{gr ? num(l.received_quantity) : "—"}</span>
                ) },
                { key: "unit_cost", header: "Unit cost", align: "right", render: (l) => money(l.unit_cost) },
                { key: "line_amount", header: "Amount", align: "right", render: (l) => money(l.line_amount) },
              ]}
              footer={<tr><td colSpan={5} className="px-3 py-1.5 text-right">Total incl. VAT (THB)</td><td className="num px-3 py-1.5 text-right">{money(po.total_amount)}</td></tr>} />
          </Card>
          <JournalEntries entries={po.journal_entries} />
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Order details" />
            <DefinitionList items={[
              ["Supplier", po.supplier_code], ["Buyer", po.buyer], ["Ship to", po.warehouse_name],
              ["Lead time", `${po.lead_time_days} days`], ["Payment terms", `${po.payment_terms_days} days`],
              ["Subtotal", baht(po.subtotal)], ["VAT", baht(po.vat_amount)],
            ]} />
          </Card>
          {gr && (
            <Card>
              <CardHeader title="Receipt & invoice" />
              <DefinitionList items={[
                ["Received by", gr.received_by_name],
                ...(si ? ([["Supplier ref.", <span key="r" className="font-mono">{si.supplier_invoice_ref}</span>], ["Invoice total", baht(si.total_amount)],
                  ["AP status", <StatusBadge key="s" status={si.status} />]] as [string, ReactNode][]) : []),
                ...(pay ? ([["Paid", `${date(pay.payment_date)} · ${pay.method.toLowerCase()}`]] as [string, string][]) : []),
              ]} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
