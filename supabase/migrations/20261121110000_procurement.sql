-- Procurement (Workshop 1.7): requisition → approval → purchase order → goods receipt → supplier invoice → payment.
--
-- Who can SEE procurement documents: procurement.view (Manager + Admin by default, editable in /permissions)
--   OR anyone in Purchasing (PUR), Warehouse (WHS) or Finance (FIN).
-- Who can CREATE a requisition: requisition.create (Manager + Admin by default) OR Warehouse / Purchasing staff.
-- Who APPROVES (tied to the person's job, not to a type):
--   estimated amount  < ฿50,000          AUTO               becomes a PO immediately
--                     ฿50,000–300,000    PURCHASING_MANAGER  the Purchasing Manager (or the Managing Director)
--                     > ฿300,000         MANAGING_DIRECTOR   the Managing Director only
--   Nobody approves their own requisition.
-- Enforcement: writes only through submit_requisition / decide_requisition (privileges revoked), and a trigger on
-- purchase_orders refuses any new PO whose requisition was not approved at the right level, even from the SQL editor.

-- ---------------------------------------------------------------- permissions
insert into public.role_permissions (role, permission, allowed)
select r, p, r in ('manager', 'admin')
from unnest(array['employee', 'manager', 'hr', 'admin']) r, unnest(array['procurement.view', 'requisition.create']) p;

create or replace function public._my_department_code()
returns text language sql stable security definer set search_path = '' as $$
  select d.code from public.employees e join public.departments d using (department_id)
  where e.employee_id = public.current_employee_id()
$$;

create or replace function public.can_view_procurement()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('procurement.view') or coalesce(public._my_department_code() in ('PUR', 'WHS', 'FIN'), false)
$$;

create or replace function public.can_create_requisition()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('requisition.create') or coalesce(public._my_department_code() in ('PUR', 'WHS'), false)
$$;

-- 2 = Managing Director, 1 = Purchasing Manager, 0 = nobody. From the employee's job title.
create or replace function public.procurement_authority(p_employee_id integer)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select case e.job_title when 'Managing Director' then 2 when 'Purchasing Manager' then 1 else 0 end
                   from public.employees e where e.employee_id = p_employee_id and e.is_active), 0)
$$;

create or replace function public.approval_level_for(p_amount numeric)
returns text language sql immutable set search_path = '' as $$
  select case when p_amount < 50000 then 'AUTO' when p_amount <= 300000 then 'PURCHASING_MANAGER' else 'MANAGING_DIRECTOR' end
$$;

create or replace function public._level_rank(p_level text)
returns integer language sql immutable set search_path = '' as $$
  select case p_level when 'AUTO' then 0 when 'PURCHASING_MANAGER' then 1 when 'MANAGING_DIRECTOR' then 2 end
$$;

-- ---------------------------------------------------------------- read access (RLS)
do $$
declare t text;
begin
  foreach t in array array['purchase_requisitions', 'purchase_requisition_lines', 'purchase_orders', 'purchase_order_lines',
                           'goods_receipts', 'goods_receipt_lines', 'supplier_invoices', 'supplier_invoice_lines',
                           'supplier_payments', 'rfqs', 'rfq_quotes'] loop
    execute format('drop policy if exists "active employees can read" on public.%I', t);
    execute format('create policy "procurement viewers can read" on public.%I for select to authenticated using ((select public.can_view_procurement()))', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- New rows need ids (the loaded data has plain INTEGER keys).
create sequence public.purchase_requisitions_seq owned by public.purchase_requisitions.requisition_id;
create sequence public.purchase_requisition_lines_seq owned by public.purchase_requisition_lines.requisition_line_id;
create sequence public.purchase_orders_seq owned by public.purchase_orders.purchase_order_id;
create sequence public.purchase_order_lines_seq owned by public.purchase_order_lines.po_line_id;
select setval('public.purchase_requisitions_seq', (select max(requisition_id) from public.purchase_requisitions));
select setval('public.purchase_requisition_lines_seq', (select max(requisition_line_id) from public.purchase_requisition_lines));
select setval('public.purchase_orders_seq', (select max(purchase_order_id) from public.purchase_orders));
select setval('public.purchase_order_lines_seq', (select max(po_line_id) from public.purchase_order_lines));
alter table public.purchase_requisitions alter column requisition_id set default nextval('public.purchase_requisitions_seq');
alter table public.purchase_requisition_lines alter column requisition_line_id set default nextval('public.purchase_requisition_lines_seq');
alter table public.purchase_orders alter column purchase_order_id set default nextval('public.purchase_orders_seq');
alter table public.purchase_order_lines alter column po_line_id set default nextval('public.purchase_order_lines_seq');

-- "PR26-001753": prefix + 2-digit year + running number within that year.
create or replace function public._next_doc_number(p_prefix text, p_date date)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare y text := to_char(p_date, 'YY'); n integer;
begin
  perform pg_advisory_xact_lock(hashtext('doc_number:' || p_prefix));
  if p_prefix = 'PR' then
    select coalesce(max(split_part(requisition_number, '-', 2)::integer), 0) into n
    from public.purchase_requisitions where requisition_number like 'PR' || y || '-%';
  else
    select coalesce(max(split_part(po_number, '-', 2)::integer), 0) into n
    from public.purchase_orders where po_number like 'PO' || y || '-%';
  end if;
  return p_prefix || y || '-' || lpad((n + 1)::text, 6, '0');
end $$;

-- ---------------------------------------------------------------- the guard: no PO without the right approval
create or replace function public._po_requires_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requisitions%rowtype; need integer;
begin
  select * into r from public.purchase_requisitions where requisition_id = new.requisition_id;
  if not found then raise exception 'A purchase order needs a requisition'; end if;
  if r.status <> 'CONVERTED' then
    raise exception 'Requisition % is % — only an approved requisition can become a purchase order', r.requisition_number, r.status
      using errcode = '42501';
  end if;
  -- the level is recomputed from the amount, so a tampered approval_level does not help
  need := greatest(public._level_rank(r.approval_level), public._level_rank(public.approval_level_for(r.estimated_amount)));
  if need > 0 and (r.approver_id is null or r.decision_date is null
                   or public.procurement_authority(r.approver_id) < need or r.approver_id = r.requested_by) then
    raise exception 'Requisition % (฿%) needs approval by the %', r.requisition_number, r.estimated_amount,
      case need when 2 then 'Managing Director' else 'Purchasing Manager' end using errcode = '42501';
  end if;
  return new;
end $$;
create trigger po_requires_approval before insert on public.purchase_orders
  for each row execute function public._po_requires_approval();

-- ---------------------------------------------------------------- create the PO for an approved requisition
create or replace function public._convert_requisition(p_requisition_id integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requisitions%rowtype; po integer; buyer integer; lead integer; sub numeric;
begin
  select * into r from public.purchase_requisitions where requisition_id = p_requisition_id;
  -- buyer: the requester if they work in Purchasing, otherwise the Buyer with the fewest open POs
  select e.employee_id into buyer from public.employees e join public.departments d using (department_id)
  where e.employee_id = r.requested_by and d.code = 'PUR';
  if buyer is null then
    select e.employee_id into buyer from public.employees e join public.departments d using (department_id)
    where d.code = 'PUR' and e.job_title = 'Buyer' and e.is_active
    order by (select count(*) from public.purchase_orders o where o.buyer_id = e.employee_id and o.status = 'OPEN'), e.employee_id
    limit 1;
  end if;
  select max(sp.lead_time_days) into lead from public.purchase_requisition_lines l
  join public.supplier_products sp on sp.product_id = l.product_id and sp.supplier_id = r.supplier_id
  where l.requisition_id = r.requisition_id;
  select round(sum(l.quantity * l.estimated_unit_cost), 2) into sub from public.purchase_requisition_lines l
  where l.requisition_id = r.requisition_id;

  insert into public.purchase_orders (po_number, supplier_id, requisition_id, buyer_id, warehouse_id, order_date, expected_date,
                                      status, subtotal, vat_amount, total_amount)
  values (public._next_doc_number('PO', current_date), r.supplier_id, r.requisition_id, coalesce(buyer, r.requested_by), r.warehouse_id,
          current_date, current_date + coalesce(lead, 7), 'OPEN', sub, round(sub * 0.07, 2), sub + round(sub * 0.07, 2))
  returning purchase_order_id into po;
  insert into public.purchase_order_lines (purchase_order_id, line_no, product_id, quantity, unit_cost, line_amount, received_quantity)
  select po, l.line_no, l.product_id, l.quantity, l.estimated_unit_cost, round(l.quantity * l.estimated_unit_cost, 2), 0
  from public.purchase_requisition_lines l where l.requisition_id = r.requisition_id order by l.line_no;
  return po;
end $$;

-- ---------------------------------------------------------------- submit (one product, from a low-stock item)
-- The client sends product, warehouse, supplier and quantity. The price, amount and approval level are computed here.
create or replace function public.submit_requisition(p_product_id integer, p_warehouse_id integer, p_supplier_id integer,
                                                     p_quantity integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare me integer := public.current_employee_id(); sp public.supplier_products%rowtype; amt numeric; lvl text;
        req integer; approver integer; onhand integer; rop integer;
begin
  if me is null or not public.can_create_requisition() then
    raise exception 'Not allowed: requisition.create' using errcode = '42501';
  end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'Quantity must be more than 0'; end if;
  select * into sp from public.supplier_products where product_id = p_product_id and supplier_id = p_supplier_id;
  if not found then raise exception 'This supplier does not sell this product (no row in supplier_products)'; end if;
  if p_quantity < sp.min_order_qty then raise exception 'Minimum order for this supplier is % units', sp.min_order_qty; end if;
  select ip.reorder_point into rop from public.inventory_policies ip where ip.product_id = p_product_id and ip.warehouse_id = p_warehouse_id;
  if not found then raise exception 'No inventory policy for this product in this warehouse'; end if;
  if exists (select 1 from public.purchase_requisitions r join public.purchase_requisition_lines l using (requisition_id)
             where r.status = 'PENDING_APPROVAL' and r.warehouse_id = p_warehouse_id and l.product_id = p_product_id) then
    raise exception 'There is already a requisition waiting for approval for this product in this warehouse';
  end if;
  select coalesce(sum(t.quantity), 0) into onhand from public.inventory_transactions t
  where t.product_id = p_product_id and t.warehouse_id = p_warehouse_id;

  amt := round(p_quantity * sp.unit_cost, 2);
  lvl := public.approval_level_for(amt);
  -- who it is routed to (like the loaded data: the approver is filled in while pending)
  select e.employee_id into approver from public.employees e
  where e.is_active and public.procurement_authority(e.employee_id) = public._level_rank(lvl) and e.employee_id <> me
  order by e.employee_id limit 1;
  if lvl <> 'AUTO' and approver is null then -- e.g. the Purchasing Manager asks: goes up to the MD
    select e.employee_id into approver from public.employees e
    where e.is_active and public.procurement_authority(e.employee_id) = 2 and e.employee_id <> me limit 1;
  end if;

  insert into public.purchase_requisitions (requisition_number, source, requested_by, warehouse_id, supplier_id, request_date,
                                            estimated_amount, approval_level, status, approver_id, decision_date)
  values (public._next_doc_number('PR', current_date), case when onhand < rop then 'AUTO_REORDER' else 'EMERGENCY' end,
          me, p_warehouse_id, p_supplier_id, current_date, amt, lvl,
          case when lvl = 'AUTO' then 'CONVERTED' else 'PENDING_APPROVAL' end,
          case when lvl = 'AUTO' then null else approver end, case when lvl = 'AUTO' then current_date end)
  returning requisition_id into req;
  insert into public.purchase_requisition_lines (requisition_id, line_no, product_id, quantity, estimated_unit_cost)
  values (req, 1, p_product_id, p_quantity, sp.unit_cost);
  if lvl = 'AUTO' then perform public._convert_requisition(req); end if;
  return req;
end $$;

-- ---------------------------------------------------------------- approve / reject
create or replace function public.can_decide_requisition(p_requisition_id integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.purchase_requisitions r
    where r.requisition_id = p_requisition_id and r.status = 'PENDING_APPROVAL'
      and r.requested_by is distinct from public.current_employee_id()
      and public.procurement_authority(public.current_employee_id())
          >= greatest(public._level_rank(r.approval_level), public._level_rank(public.approval_level_for(r.estimated_amount)), 1))
$$;

create or replace function public.decide_requisition(p_requisition_id integer, p_approve boolean, p_reason text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare me integer := public.current_employee_id(); r public.purchase_requisitions%rowtype;
begin
  select * into r from public.purchase_requisitions where requisition_id = p_requisition_id for update;
  if not found or not public.can_view_procurement() then raise exception 'Requisition not found' using errcode = '42501'; end if;
  if r.status <> 'PENDING_APPROVAL' then raise exception 'Only pending requisitions can be decided (this one is %)', r.status; end if;
  if not public.can_decide_requisition(p_requisition_id) then
    raise exception '%', case when r.requested_by = me then 'You can''t approve your own requisition'
      when public._level_rank(r.approval_level) = 2 then 'Over ฿300,000: only the Managing Director can approve this'
      else '฿50,000–300,000: only the Purchasing Manager (or the Managing Director) can approve this' end using errcode = '42501';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason when rejecting'; end if;
  update public.purchase_requisitions
  set status = case when p_approve then 'CONVERTED' else 'REJECTED' end, approver_id = me, decision_date = current_date,
      rejection_reason = case when p_approve then null else trim(p_reason) end
  where requisition_id = p_requisition_id;
  if p_approve then return public._convert_requisition(p_requisition_id); end if;
  return null;
end $$;

-- ---------------------------------------------------------------- supplier scorecard (stretch)
create or replace function public.supplier_scorecard()
returns table (supplier_id integer, supplier_code text, supplier text, purchase_orders integer, receipts integer,
               on_time_receipts integer, on_time_pct numeric, units_received integer, units_rejected integer,
               rejection_pct numeric, invoices integer, invoice_exceptions integer, exception_pct numeric, on_hold integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_view_procurement() then raise exception 'Not allowed: procurement.view' using errcode = '42501'; end if;
  return query
  with g as (
    select o.supplier_id, count(*)::integer as receipts, count(*) filter (where gr.receipt_date <= o.expected_date)::integer as on_time
    from public.goods_receipts gr join public.purchase_orders o using (purchase_order_id) group by o.supplier_id
  ), u as (
    select o.supplier_id, sum(l.quantity_received)::integer as recv, sum(l.quantity_rejected)::integer as rej
    from public.goods_receipt_lines l join public.goods_receipts gr using (goods_receipt_id)
    join public.purchase_orders o using (purchase_order_id) group by o.supplier_id
  ), i as (
    select si.supplier_id, count(*)::integer as n, count(*) filter (where si.match_status = 'EXCEPTION')::integer as exc,
           count(*) filter (where si.status = 'ON_HOLD')::integer as hold
    from public.supplier_invoices si group by si.supplier_id
  ), p as (select o.supplier_id, count(*)::integer as n from public.purchase_orders o group by o.supplier_id)
  select s.supplier_id, s.supplier_code, s.name, coalesce(p.n, 0), coalesce(g.receipts, 0), coalesce(g.on_time, 0),
         round(100.0 * g.on_time / nullif(g.receipts, 0), 1), coalesce(u.recv, 0), coalesce(u.rej, 0),
         round(100.0 * u.rej / nullif(u.recv, 0), 2), coalesce(i.n, 0), coalesce(i.exc, 0),
         round(100.0 * i.exc / nullif(i.n, 0), 1), coalesce(i.hold, 0)
  from public.suppliers s
  left join p on p.supplier_id = s.supplier_id left join g on g.supplier_id = s.supplier_id
  left join u on u.supplier_id = s.supplier_id left join i on i.supplier_id = s.supplier_id
  order by s.supplier_code;
end $$;

-- ---------------------------------------------------------------- badges: + requisitions waiting for me
drop function if exists public.badge_counts();
create function public.badge_counts()
returns table (approvals integer, my_leave integer, requisitions integer)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::integer from public.leave_requests r
     where r.status = 'PENDING' and r.employee_id <> public.current_employee_id() and public.can_decide_leave(r.request_id)),
    (select count(*)::integer from public.leave_requests r
     where r.employee_id = public.current_employee_id() and r.status in ('APPROVED', 'REJECTED')
       and r.decided_at > coalesce((select n.seen_at from public.notification_reads n
                                    where n.employee_id = public.current_employee_id() and n.feed = 'my_leave'), '-infinity')),
    (select count(*)::integer from public.purchase_requisitions r
     where r.status = 'PENDING_APPROVAL' and public.procurement_authority(public.current_employee_id()) > 0
       and public.can_decide_requisition(r.requisition_id))
  where public.current_employee_id() is not null
$$;

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array['public._my_department_code()', 'public._next_doc_number(text, date)', 'public._po_requires_approval()',
                           'public._convert_requisition(integer)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.can_view_procurement()', 'public.can_create_requisition()', 'public.procurement_authority(integer)',
                           'public.approval_level_for(numeric)', 'public._level_rank(text)',
                           'public.submit_requisition(integer, integer, integer, integer)', 'public.can_decide_requisition(integer)',
                           'public.decide_requisition(integer, boolean, text)', 'public.supplier_scorecard()', 'public.badge_counts()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
