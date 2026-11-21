"use client";

import { useActionState, useState } from "react";
import { submitRequisition } from "../../actions";

export type SupplierOption = {
  supplier_id: number; name: string; code: string; unit_cost: number; lead_time_days: number; min_order_qty: number; is_preferred: boolean;
};

const thb = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "THB", maximumFractionDigits: 0 });
/** Preview only: the database computes the amount and the level again from supplier_products. */
const level = (amt: number) => (amt < 50000 ? { t: "Auto-approved → PO right away", c: "text-ok" }
  : amt <= 300000 ? { t: "Needs the Purchasing Manager", c: "text-amber-600" } : { t: "Needs the Managing Director", c: "text-danger" });

export function RequisitionForm({ productId, warehouseId, uom, suggested, options }:
  { productId: number; warehouseId: number; uom: string; suggested: number; options: SupplierOption[] }) {
  const [state, action, pending] = useActionState(submitRequisition, undefined);
  const [supplier, setSupplier] = useState(options[0].supplier_id);
  const opt = options.find((o) => o.supplier_id === supplier) ?? options[0];
  const [qty, setQty] = useState(Math.max(suggested, opt.min_order_qty));
  const amt = Math.round(qty * opt.unit_cost * 100) / 100;
  const lv = level(amt);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="warehouse_id" value={warehouseId} />
      <fieldset className="rounded-xl border border-line bg-surface">
        <legend className="ml-4 px-1 text-sm font-medium">Supplier (from supplier_products)</legend>
        {options.map((o) => (
          <label key={o.supplier_id} className="flex cursor-pointer items-center gap-3 border-t border-line px-4 py-2.5 text-sm first-of-type:border-t-0 hover:bg-background/50">
            <input type="radio" name="supplier_id" value={o.supplier_id} checked={supplier === o.supplier_id}
              onChange={() => { setSupplier(o.supplier_id); setQty((q) => Math.max(q, o.min_order_qty)); }} />
            <span className="flex-1">{o.name} <span className="font-mono text-xs text-muted">{o.code}</span>
              {o.is_preferred && <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">preferred</span>}</span>
            <span className="tabular-nums">{thb(o.unit_cost)}/{uom}</span>
            <span className="w-24 text-right text-xs text-muted">{o.lead_time_days} days · min {o.min_order_qty}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">Quantity ({uom})
          <input name="quantity" type="number" min={opt.min_order_qty} step={1} value={qty} onChange={(e) => setQty(Number(e.target.value))}
            className="mt-1 block h-9 w-36 rounded-md border border-line bg-surface px-3 tabular-nums" />
        </label>
        <div className="text-sm">
          <div className="text-muted">Estimated (excl. VAT)</div>
          <div className="text-lg font-semibold tabular-nums">{thb(amt)}</div>
        </div>
        <div className={`pb-1 text-sm font-medium ${lv.c}`}>{lv.t}</div>
      </div>
      <p className="text-xs text-muted">Default quantity = reorder point − on hand. Under ฿50,000 auto · ฿50,000–300,000 Purchasing Manager · over ฿300,000 Managing Director.</p>
      {state?.error && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{state.error}</p>}
      <button disabled={pending} className="h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Submitting…" : "Submit requisition"}
      </button>
    </form>
  );
}
