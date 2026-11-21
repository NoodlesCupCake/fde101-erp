-- Sales orders (Workshop 1.8): order → delivery → invoice → payment.
--
-- Who sees which orders (RLS, so changing the URL or calling the API gives the same answer):
--   a sales rep              → orders/customers where sales_rep_id = me
--   a manager                → also everyone below them in the reporting line (Sales Manager E0004 = the whole team;
--                              the Managing Director sees everything because everyone reports up to him)
--   sales.view_all           → everything (Admin by default, editable in /permissions)
--   Finance / Warehouse      → everything (they invoice and ship)
-- Creating an order: Sales department staff, or sales.create (Admin by default), and only for a customer you can see.
-- The browser sends customer, products, quantities and discount %. The database takes the price from
-- products.list_price and computes line_amount, subtotal, vat_amount (7%) and total_amount, so a tampered request can't
-- change the money. Discount is capped at the segment's rate + 5 (Retail 0, Contractor 4, Wholesale 8; promo +5),
-- the same rule as the loaded data.
-- Not enough stock in the customer's default warehouse: the order is still accepted as a BACKORDER (status OPEN, ships
-- when stock arrives, as in the data, where backorders are cancelled after 30 days). The function returns which lines
-- are short so the UI can say so. "Available" = on hand − quantities on OPEN orders not delivered yet.

insert into public.role_permissions (role, permission, allowed)
select r, p, r = 'admin'
from unnest(array['employee', 'manager', 'hr', 'admin']) r, unnest(array['sales.view_all', 'sales.create']) p;

-- Me and everyone below me in the reporting line.
create or replace function public.my_team_ids()
returns integer[] language sql stable security definer set search_path = '' as $$
  with recursive t(id) as (
    select public.current_employee_id() where public.current_employee_id() is not null
    union
    select e.employee_id from public.employees e join t on e.manager_id = t.id
  )
  select coalesce(array_agg(id), array[]::integer[]) from t
$$;

create or replace function public.can_view_all_sales()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('sales.view_all') or coalesce(public._my_department_code() in ('FIN', 'WHS'), false)
$$;

create or replace function public.can_create_sales_order()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('sales.create') or coalesce(public._my_department_code() = 'SAL', false)
$$;

-- ---------------------------------------------------------------- RLS
drop policy if exists "active employees can read" on public.customers;
drop policy if exists "active employees can read" on public.sales_orders;
drop policy if exists "active employees can read" on public.sales_order_lines;
drop policy if exists "active employees can read" on public.deliveries;
drop policy if exists "active employees can read" on public.sales_invoices;
drop policy if exists "active employees can read" on public.customer_payments;

create policy "own or team customers" on public.customers for select to authenticated
  using ((select public.can_view_all_sales()) or sales_rep_id = any ((select public.my_team_ids())::integer[]));
create policy "own or team orders" on public.sales_orders for select to authenticated
  using ((select public.can_view_all_sales()) or sales_rep_id = any ((select public.my_team_ids())::integer[]));
create policy "lines of visible orders" on public.sales_order_lines for select to authenticated
  using ((select public.can_view_all_sales()) or sales_order_id in (select o.sales_order_id from public.sales_orders o));
create policy "deliveries of visible orders" on public.deliveries for select to authenticated
  using ((select public.can_view_all_sales()) or sales_order_id in (select o.sales_order_id from public.sales_orders o));
create policy "invoices of visible orders" on public.sales_invoices for select to authenticated
  using ((select public.can_view_all_sales()) or sales_order_id in (select o.sales_order_id from public.sales_orders o));
create policy "payments of visible invoices" on public.customer_payments for select to authenticated
  using ((select public.can_view_all_sales()) or invoice_id in (select i.invoice_id from public.sales_invoices i));

revoke insert, update, delete, truncate on public.customers, public.sales_orders, public.sales_order_lines, public.deliveries,
  public.sales_invoices, public.customer_payments from anon, authenticated;
revoke all on public.customers, public.sales_orders, public.sales_order_lines, public.deliveries,
  public.sales_invoices, public.customer_payments from anon;

create index if not exists ix_so_rep on public.sales_orders(sales_rep_id, order_date desc);
create index if not exists ix_so_customer on public.sales_orders(customer_id);
create index if not exists ix_sol_order on public.sales_order_lines(sales_order_id);

-- ---------------------------------------------------------------- ids + numbers
create sequence public.sales_orders_seq owned by public.sales_orders.sales_order_id;
create sequence public.sales_order_lines_seq owned by public.sales_order_lines.sales_order_line_id;
select setval('public.sales_orders_seq', (select max(sales_order_id) from public.sales_orders));
select setval('public.sales_order_lines_seq', (select max(sales_order_line_id) from public.sales_order_lines));
alter table public.sales_orders alter column sales_order_id set default nextval('public.sales_orders_seq');
alter table public.sales_order_lines alter column sales_order_line_id set default nextval('public.sales_order_lines_seq');

create or replace function public._next_doc_number(p_prefix text, p_date date)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare y text := to_char(p_date, 'YY'); n integer;
begin
  perform pg_advisory_xact_lock(hashtext('doc_number:' || p_prefix));
  if p_prefix = 'PR' then
    select coalesce(max(split_part(requisition_number, '-', 2)::integer), 0) into n
    from public.purchase_requisitions where requisition_number like 'PR' || y || '-%';
  elsif p_prefix = 'PO' then
    select coalesce(max(split_part(po_number, '-', 2)::integer), 0) into n
    from public.purchase_orders where po_number like 'PO' || y || '-%';
  elsif p_prefix = 'SO' then
    select coalesce(max(split_part(order_number, '-', 2)::integer), 0) into n
    from public.sales_orders where order_number like 'SO' || y || '-%';
  else
    raise exception 'Unknown document prefix %', p_prefix;
  end if;
  return p_prefix || y || '-' || lpad((n + 1)::text, 6, '0');
end $$;
revoke execute on function public._next_doc_number(text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- availability (for the form and the backorder check)
create or replace function public.sales_availability(p_warehouse_id integer, p_product_ids integer[])
returns table (product_id integer, on_hand integer, on_open_orders integer, available integer)
language sql stable security definer set search_path = '' as $$
  select p.id,
         coalesce((select sum(t.quantity) from public.inventory_transactions t
                   where t.product_id = p.id and t.warehouse_id = p_warehouse_id), 0)::integer,
         coalesce((select sum(l.quantity) from public.sales_order_lines l join public.sales_orders o using (sales_order_id)
                   where l.product_id = p.id and o.warehouse_id = p_warehouse_id and o.status = 'OPEN'
                     and not exists (select 1 from public.deliveries d where d.sales_order_id = o.sales_order_id)), 0)::integer,
         0
  from unnest(p_product_ids) as p(id)
  where public.current_employee_id() is not null
$$;
-- available = on_hand − on_open_orders (computed in a wrapper so both numbers are visible)
create or replace function public.sales_available(p_warehouse_id integer, p_product_ids integer[])
returns table (product_id integer, on_hand integer, on_open_orders integer, available integer)
language sql stable security definer set search_path = '' as $$
  select a.product_id, a.on_hand, a.on_open_orders, a.on_hand - a.on_open_orders
  from public.sales_availability(p_warehouse_id, p_product_ids) a
$$;

create or replace function public.segment_discount(p_segment text)
returns numeric language sql immutable set search_path = '' as $$
  select case p_segment when 'Retail' then 0 when 'Contractor' then 4 when 'Wholesale' then 8 else 0 end::numeric
$$;

-- ---------------------------------------------------------------- create
-- p_lines: [{"product_id": 12, "quantity": 3, "discount_pct": 4}, ...]   (discount_pct optional → segment rate)
create or replace function public.create_sales_order(p_customer_id integer, p_lines jsonb, p_requested_date date default null)
returns table (sales_order_id integer, order_number text, subtotal numeric, vat_amount numeric, total_amount numeric,
               backorder_lines jsonb)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare me integer := public.current_employee_id(); c public.customers%rowtype; so integer; num text;
        sub numeric; vat numeric; short jsonb; max_disc numeric; bad text;
begin
  if me is null or not public.can_create_sales_order() then
    raise exception 'Not allowed: sales.create' using errcode = '42501';
  end if;
  select * into c from public.customers x where x.customer_id = p_customer_id and x.is_active;
  if not found or not (public.can_view_all_sales() or c.sales_rep_id = any (public.my_team_ids())) then
    raise exception 'Customer not found (or not one of yours)' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one product';
  end if;
  if jsonb_array_length(p_lines) > 50 then raise exception 'At most 50 lines per order'; end if;
  if p_requested_date is not null and p_requested_date < current_date then raise exception 'Requested date can''t be in the past'; end if;
  max_disc := public.segment_discount(c.segment) + 5;

  drop table if exists pg_temp._l;
  create temp table _l on commit drop as
  select row_number() over (order by ord)::integer as line_no, (x ->> 'product_id')::integer as product_id,
         (x ->> 'quantity')::integer as quantity,
         coalesce((x ->> 'discount_pct')::numeric, public.segment_discount(c.segment)) as discount_pct
  from jsonb_array_elements(p_lines) with ordinality as a(x, ord);

  select string_agg(msg, '; ') into bad from (
    select case
      when l.product_id is null or l.quantity is null then 'line ' || l.line_no || ': product and quantity are required'
      when l.quantity <= 0 or l.quantity > 100000 then 'line ' || l.line_no || ': quantity must be 1–100,000'
      when l.discount_pct < 0 or l.discount_pct > max_disc then
        'line ' || l.line_no || ': discount must be 0–' || max_disc || '% for a ' || c.segment || ' customer'
      when p.product_id is null then 'line ' || l.line_no || ': unknown product'
      when not p.is_active or p.discontinued_date is not null then 'line ' || l.line_no || ': ' || p.sku || ' is discontinued'
    end as msg
    from _l l left join public.products p using (product_id)) m where msg is not null;
  if bad is not null then raise exception '%', bad; end if;
  if (select count(*) <> count(distinct l.product_id) from _l l) then raise exception 'Each product only once per order'; end if;

  -- money: price from the product, computed here
  alter table _l add column unit_price numeric, add column line_amount numeric;
  update _l l set unit_price = p.list_price, line_amount = round(l.quantity * p.list_price * (1 - l.discount_pct / 100), 2)
  from public.products p where p.product_id = l.product_id;
  select round(sum(l.line_amount), 2) into sub from _l l;
  vat := round(sub * 0.07, 2);

  num := public._next_doc_number('SO', current_date);
  insert into public.sales_orders (order_number, customer_id, sales_rep_id, warehouse_id, order_date, requested_date, status,
                                   subtotal, vat_amount, total_amount, currency)
  values (num, c.customer_id, c.sales_rep_id, c.default_warehouse_id, current_date,
          coalesce(p_requested_date, current_date + 3), 'OPEN', sub, vat, sub + vat, 'THB')
  returning sales_orders.sales_order_id into so;
  -- stock check before this order's own lines count as "on open orders"
  select jsonb_agg(jsonb_build_object('product_id', l.product_id, 'sku', p.sku, 'quantity', l.quantity, 'available', greatest(a.available, 0))
                   order by l.line_no) into short
  from _l l join public.products p using (product_id)
  join public.sales_available(c.default_warehouse_id, (select array_agg(product_id) from _l)) a using (product_id)
  where a.available < l.quantity;
  insert into public.sales_order_lines (sales_order_id, line_no, product_id, quantity, unit_price, discount_pct, line_amount)
  select so, l.line_no, l.product_id, l.quantity, l.unit_price, l.discount_pct, l.line_amount from _l l order by l.line_no;

  return query select so, num, sub, vat, sub + vat, coalesce(short, '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array['public.my_team_ids()', 'public.can_view_all_sales()', 'public.can_create_sales_order()',
                           'public.sales_available(integer, integer[])', 'public.segment_discount(text)',
                           'public.create_sales_order(integer, jsonb, date)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke execute on function public.sales_availability(integer, integer[]) from public, anon, authenticated;
end $$;
