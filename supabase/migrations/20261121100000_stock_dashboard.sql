-- Stock dashboard (Workshop 1.6). There is no stock-on-hand table: it is derived from inventory_transactions.
--   on hand (units) = SUM(quantity)        quantity is signed: + in (OPENING/RECEIPT), - out (SHIPMENT/ADJUSTMENT)
--   stock value     = SUM(total_cost)      total_cost is signed and already at moving-average cost on the way out,
--                                          so the sum equals the GL inventory account 1200 (checked: 16,932,503.93).
--   (qty × today's unit_cost would be wrong: unit_cost changes with every receipt.)
-- "Today" = 2026-10-31, the dataset's last posting date. All aggregation happens here, not in the browser.
--
-- Who can see it: stock.view (Manager + Admin by default, editable in /permissions) OR anyone working in
-- Warehouse (WHS), Purchasing (PUR) or Finance (FIN). Everyone else gets nothing, also via the API.

insert into public.role_permissions (role, permission, allowed)
select r, 'stock.view', r in ('manager', 'admin') from unnest(array['employee', 'manager', 'hr', 'admin']) r;

create or replace function public.can_view_stock()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('stock.view') or exists (
    select 1 from public.employees e join public.departments d using (department_id)
    where e.employee_id = public.current_employee_id() and d.code in ('WHS', 'PUR', 'FIN'))
$$;
revoke execute on function public.can_view_stock() from public, anon;
grant execute on function public.can_view_stock() to authenticated;

-- Raw movement tables: only for people who may see stock.
drop policy "active employees can read" on public.inventory_transactions;
drop policy "active employees can read" on public.inventory_policies;
create policy "stock viewers can read" on public.inventory_transactions for select to authenticated using ((select public.can_view_stock()));
create policy "stock viewers can read" on public.inventory_policies for select to authenticated using ((select public.can_view_stock()));

create or replace function public._stock_guard()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_view_stock() then raise exception 'Not allowed: stock.view' using errcode = '42501'; end if;
end $$;
revoke execute on function public._stock_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- on hand per product × warehouse (+ reorder, cover, dead stock)
create or replace function public.stock_on_hand(p_warehouse_id integer default null, p_category_id integer default null,
                                                p_as_of date default date '2026-10-31')
returns table (product_id integer, sku text, product text, category_id integer, category text, warehouse_id integer,
               warehouse text, on_hand integer, stock_value numeric, avg_cost numeric, reorder_point integer, reorder_qty integer,
               below_reorder boolean, shipped_90d integer, days_of_cover numeric, last_shipment date, dead_stock boolean,
               shrink_units_365d integer, shrink_value_365d numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._stock_guard();
  return query
  with t as (
    select x.product_id, x.warehouse_id,
           sum(x.quantity)::integer as on_hand,
           round(sum(x.total_cost), 2) as stock_value,
           (-sum(x.quantity) filter (where x.txn_type = 'SHIPMENT' and x.txn_date > p_as_of - 90))::integer as shipped_90d,
           max(x.txn_date) filter (where x.txn_type = 'SHIPMENT') as last_shipment,
           (-sum(x.quantity) filter (where x.txn_type = 'ADJUSTMENT' and x.txn_date > p_as_of - 365))::integer as shrink_units,
           round(-sum(x.total_cost) filter (where x.txn_type = 'ADJUSTMENT' and x.txn_date > p_as_of - 365), 2) as shrink_value
    from public.inventory_transactions x
    where x.txn_date <= p_as_of
      and (p_warehouse_id is null or x.warehouse_id = p_warehouse_id)
    group by x.product_id, x.warehouse_id
  )
  select p.product_id, p.sku, p.name, c.category_id, c.name, w.warehouse_id, w.code,
         coalesce(t.on_hand, 0), coalesce(t.stock_value, 0),
         case when t.on_hand > 0 then round(t.stock_value / t.on_hand, 2) end,
         ip.reorder_point, ip.reorder_qty,
         coalesce(t.on_hand, 0) < ip.reorder_point,
         coalesce(t.shipped_90d, 0),
         case when coalesce(t.shipped_90d, 0) > 0 then round(coalesce(t.on_hand, 0) / (t.shipped_90d / 90.0), 1) end,
         t.last_shipment,
         coalesce(t.on_hand, 0) > 0 and coalesce(t.shipped_90d, 0) = 0,
         coalesce(t.shrink_units, 0), coalesce(t.shrink_value, 0)
  from public.inventory_policies ip
  join public.products p using (product_id)
  join public.product_categories c using (category_id)
  join public.warehouses w using (warehouse_id)
  left join t on t.product_id = ip.product_id and t.warehouse_id = ip.warehouse_id
  where (p_warehouse_id is null or ip.warehouse_id = p_warehouse_id)
    and (p_category_id is null or p.category_id = p_category_id);
end $$;

-- ---------------------------------------------------------------- month-end stock value by warehouse
create or replace function public.stock_value_by_month(p_warehouse_id integer default null, p_category_id integer default null)
returns table (month date, warehouse text, stock_value numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._stock_guard();
  return query
  with months as (
    select generate_series(date '2024-12-01', date '2026-10-01', interval '1 month')::date as m
  ), net as (
    select date_trunc('month', x.txn_date)::date as m, x.warehouse_id, sum(x.total_cost) as v
    from public.inventory_transactions x join public.products p using (product_id)
    where (p_warehouse_id is null or x.warehouse_id = p_warehouse_id)
      and (p_category_id is null or p.category_id = p_category_id)
    group by 1, 2
  )
  select mo.m, w.code,
         round(sum(coalesce(n.v, 0)) over (partition by w.warehouse_id order by mo.m), 2)
  from months mo
  cross join public.warehouses w
  left join net n on n.m = mo.m and n.warehouse_id = w.warehouse_id
  where (p_warehouse_id is null or w.warehouse_id = p_warehouse_id)
  order by mo.m, w.code;
end $$;

-- ---------------------------------------------------------------- one product's movements with a running balance
create or replace function public.product_movements(p_product_id integer, p_warehouse_id integer default null)
returns table (inventory_txn_id integer, txn_date date, warehouse text, txn_type text, quantity integer, unit_cost numeric,
               total_cost numeric, reference_type text, reference_id integer, running_qty bigint, running_value numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._stock_guard();
  return query
  select x.inventory_txn_id, x.txn_date, w.code, x.txn_type, x.quantity, x.unit_cost, x.total_cost, x.reference_type, x.reference_id,
         sum(x.quantity) over (partition by x.warehouse_id order by x.txn_date, x.inventory_txn_id),
         round(sum(x.total_cost) over (partition by x.warehouse_id order by x.txn_date, x.inventory_txn_id), 2)
  from public.inventory_transactions x join public.warehouses w using (warehouse_id)
  where x.product_id = p_product_id and (p_warehouse_id is null or x.warehouse_id = p_warehouse_id)
  order by x.txn_date desc, x.inventory_txn_id desc;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.stock_on_hand(integer, integer, date)', 'public.stock_value_by_month(integer, integer)',
                           'public.product_movements(integer, integer)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
