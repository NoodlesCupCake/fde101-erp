"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { checkAvailability, createSalesOrder, type Availability } from "../actions";

export type CustomerOption = { id: number; code: string; name: string; segment: string; warehouse_id: number; warehouse: string; rep: string };
export type ProductOption = { id: number; sku: string; name: string; uom: string; price: number };
type Line = { key: number; product: number | ""; qty: number; disc: number };

const SEG: Record<string, number> = { Retail: 0, Contractor: 4, Wholesale: 8 };
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cls = "h-9 rounded-md border border-line bg-surface px-2 text-sm";

export function OrderForm({ customers, products }: { customers: CustomerOption[]; products: ProductOption[] }) {
  const [state, action, pending] = useActionState(createSalesOrder, undefined);
  const [cust, setCust] = useState<number | "">("");
  const c = customers.find((x) => x.id === cust);
  const base = c ? SEG[c.segment] ?? 0 : 0;
  const [lines, setLines] = useState<Line[]>([{ key: 1, product: "", qty: 1, disc: 0 }]);
  const [avail, setAvail] = useState<Record<number, Availability>>({});
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const productKey = lines.map((l) => l.product).join(",");
  useEffect(() => {
    const ids = lines.map((l) => l.product).filter((x): x is number => x !== "");
    if (!c || !ids.length) return;
    let alive = true;
    checkAvailability(c.warehouse_id, ids).then((rows) => alive && setAvail(Object.fromEntries(rows.map((r) => [r.product_id, r]))));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.warehouse_id, productKey]);

  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const priced = lines.map((l) => {
    const p = l.product === "" ? undefined : byId.get(l.product);
    return { ...l, p, amount: p ? r2(l.qty * p.price * (1 - l.disc / 100)) : 0 };
  });
  const subtotal = r2(priced.reduce((s, l) => s + l.amount, 0));
  const vat = r2(subtotal * 0.07);
  const payload = JSON.stringify(priced.filter((l) => l.p).map((l) => ({ product_id: l.product, quantity: l.qty, discount_pct: l.disc })));
  const chosen = new Set(lines.map((l) => l.product));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="lines" value={payload} />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
        <label className="text-sm">Customer
          <select name="customer_id" required value={cust} className={`${cls} mt-1 block w-80`}
            onChange={(e) => { const id = e.target.value ? Number(e.target.value) : ""; setCust(id);
              const nb = SEG[customers.find((x) => x.id === id)?.segment ?? ""] ?? 0; setLines((ls) => ls.map((l) => ({ ...l, disc: nb }))); }}>
            <option value="">Choose…</option>
            {customers.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.code}</option>)}
          </select>
        </label>
        {c && <p className="pb-2 text-sm text-muted">{c.segment} (discount {base}–{base + 5}%) · ships from <b>{c.warehouse}</b> · rep {c.rep}</p>}
        <label className="ml-auto text-sm">Requested date
          <input type="date" name="requested_date" className={`${cls} mt-1 block`} min={new Date().toISOString().slice(0, 10)} />
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr><th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">List price</th><th className="px-3 py-2 text-right font-medium">Discount %</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 font-medium">Stock in {c?.warehouse ?? "warehouse"}</th><th /></tr>
          </thead>
          <tbody>
            {priced.map((l) => {
              const a = l.product === "" ? undefined : avail[l.product];
              const short = a && a.available < l.qty;
              return (
                <tr key={l.key} className="border-t border-line">
                  <td className="px-3 py-2">
                    <select value={l.product} onChange={(e) => set(l.key, { product: e.target.value ? Number(e.target.value) : "" })} className={`${cls} w-72`}>
                      <option value="">Choose a product…</option>
                      {products.map((p) => <option key={p.id} value={p.id} disabled={chosen.has(p.id) && p.id !== l.product}>{p.sku} · {p.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right"><input type="number" min={1} value={l.qty} onChange={(e) => set(l.key, { qty: Math.max(1, Number(e.target.value) || 1) })} className={`${cls} w-20 text-right`} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.p ? `${money(l.p.price)}/${l.p.uom}` : "–"}</td>
                  <td className="px-3 py-2 text-right"><input type="number" min={0} max={base + 5} step={0.5} value={l.disc} onChange={(e) => set(l.key, { disc: Number(e.target.value) || 0 })} className={`${cls} w-20 text-right`} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(l.amount)}</td>
                  <td className={`px-3 py-2 text-xs ${short ? "font-medium text-danger" : "text-muted"}`}>
                    {!a ? "–" : short ? `only ${Math.max(a.available, 0)} available → backorder` : `${a.available} available`}
                  </td>
                  <td className="px-3 py-2">{lines.length > 1 && <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-muted hover:text-danger" aria-label="Remove line">✕</button>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="tabular-nums">
            <tr className="border-t border-line"><td colSpan={7} className="px-3 py-2">
              <button type="button" onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, product: "", qty: 1, disc: base }])} className="text-sm text-brand hover:underline">+ Add line</button>
            </td></tr>
            {[["Subtotal", subtotal], ["VAT 7%", vat], ["Total (preview)", r2(subtotal + vat)]].map(([l, v]) => (
              <tr key={l as string}><td colSpan={4} className="px-3 py-1 text-right text-muted">{l}</td><td className="px-3 py-1 text-right font-semibold">{money(v as number)}</td><td colSpan={2} /></tr>
            ))}
          </tfoot>
        </table>
      </div>
      {state?.error && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{state.error}</p>}
      <button disabled={pending || !c || payload === "[]"} className="h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Saving…" : "Create order"}
      </button>
    </form>
  );
}
