/**
 * The SQL behind each number on the stock dashboard, written as plain queries over the raw tables
 * (the same logic as the stock_* functions in supabase/migrations/20261121100000_stock_dashboard.sql).
 * Paste into the Supabase SQL Editor to check the dashboard by hand.
 */
const q = (s: string) => s.replace(/^\n/, "").replace(/\n\s*$/, "");
const filters = (wh: number | null, cat: number | null, alias = "t") =>
  [wh ? `  and ${alias}.warehouse_id = ${wh}` : "", cat ? `  and p.category_id = ${cat}` : ""].filter(Boolean).join("\n");

export function kpiSql(wh: number | null, cat: number | null) {
  return q(`
-- Stock value = SUM(total_cost) (signed, moving-average cost). Must equal GL 1200 Inventory when unfiltered.
select round(sum(t.total_cost), 2) as stock_value,
       sum(t.quantity)             as units_on_hand
from inventory_transactions t
join products p using (product_id)
where t.txn_date <= date '2026-10-31'
${filters(wh, cat)}
;

-- Cross-check with the general ledger
select round(sum(debit - credit), 2) as gl_inventory from journal_lines where account_code = '1200';`);
}

export function listSql(view: string, wh: number | null, cat: number | null) {
  const conds = [
    view === "reorder" ? "s.on_hand < s.reorder_point" : view === "dead" ? "s.on_hand > 0 and s.shipped_90d = 0"
      : view === "shrinkage" ? "s.shrink_units_365d > 0" : "",
    wh ? `s.warehouse_id = ${wh}` : "",
    cat ? `p.category_id = ${cat}` : "",
  ].filter(Boolean);
  const order = view === "reorder" ? "order by on_hand - reorder_point"
    : view === "shrinkage" ? "order by shrink_value_365d desc" : "order by stock_value desc";
  return q(`
-- One row per inventory_policies row (product × warehouse = 660), stock derived from the movements
with s as (
  select ip.product_id, ip.warehouse_id, ip.reorder_point,
         coalesce(sum(t.quantity), 0)                                              as on_hand,
         coalesce(round(sum(t.total_cost), 2), 0)                                  as stock_value,
         coalesce(-sum(t.quantity) filter (where t.txn_type = 'SHIPMENT'
                                             and t.txn_date > date '2026-10-31' - 90), 0)   as shipped_90d,
         coalesce(-sum(t.quantity) filter (where t.txn_type = 'ADJUSTMENT'
                                             and t.txn_date > date '2026-10-31' - 365), 0)  as shrink_units_365d,
         coalesce(round(-sum(t.total_cost) filter (where t.txn_type = 'ADJUSTMENT'
                                             and t.txn_date > date '2026-10-31' - 365), 2), 0) as shrink_value_365d
  from inventory_policies ip
  left join inventory_transactions t
         on t.product_id = ip.product_id and t.warehouse_id = ip.warehouse_id and t.txn_date <= date '2026-10-31'
  group by ip.product_id, ip.warehouse_id, ip.reorder_point
)
select p.sku, p.name, w.code as warehouse, s.on_hand, s.reorder_point, s.stock_value,
       case when s.shipped_90d > 0 then round(s.on_hand / (s.shipped_90d / 90.0), 1) end as days_of_cover,
       s.shrink_units_365d, s.shrink_value_365d
from s
join products p using (product_id)
join warehouses w using (warehouse_id)
${conds.length ? `where ${conds.join("\n  and ")}\n` : ""}${order};`);
}

export function monthSql(wh: number | null, cat: number | null) {
  return q(`
-- Month-end stock value per warehouse = running total of each month's net movement value
with net as (
  select date_trunc('month', t.txn_date)::date as month, t.warehouse_id, sum(t.total_cost) as v
  from inventory_transactions t
  join products p using (product_id)
  where true
${filters(wh, cat)}
  group by 1, 2
)
select m.month, w.code as warehouse,
       round(sum(coalesce(n.v, 0)) over (partition by w.warehouse_id order by m.month), 2) as stock_value
from generate_series(date '2024-12-01', date '2026-10-01', interval '1 month') as m(month)
cross join warehouses w
left join net n on n.month = m.month and n.warehouse_id = w.warehouse_id
${wh ? `where w.warehouse_id = ${wh}\n` : ""}order by m.month, w.code;`);
}

export function skuSql(sku: string, wh: number | null) {
  const safe = sku.replace(/'/g, "''");
  return q(`
-- By hand: one SKU's stock straight from the raw movements. Compare with the cards above.
select p.sku,
       w.code                       as warehouse,
       sum(t.quantity)              as on_hand,
       round(sum(t.total_cost), 2)  as stock_value,
       count(*)                     as movements,
       ip.reorder_point,
       sum(t.quantity) < ip.reorder_point as below_reorder
from inventory_transactions t
join products p            using (product_id)
join warehouses w          using (warehouse_id)
join inventory_policies ip on ip.product_id = t.product_id and ip.warehouse_id = t.warehouse_id
where p.sku = '${safe}'
  and t.txn_date <= date '2026-10-31'${wh ? `\n  and t.warehouse_id = ${wh}` : ""}
group by p.sku, w.code, ip.reorder_point
order by w.code;

-- Why not "on hand × unit cost"? unit_cost changes with every receipt, so this drifts:
select w.code as warehouse,
       round(sum(t.total_cost), 2) as correct_value,
       round(sum(t.quantity) * (array_agg(t.unit_cost order by t.txn_date desc, t.inventory_txn_id desc))[1], 2) as qty_x_last_cost
from inventory_transactions t
join products p   using (product_id)
join warehouses w using (warehouse_id)
where p.sku = '${safe}'${wh ? `\n  and t.warehouse_id = ${wh}` : ""}
group by w.code
order by w.code;`);
}
