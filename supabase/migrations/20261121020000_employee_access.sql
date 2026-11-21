-- Every account maps to exactly one row in employees (matched by email), and only ACTIVE employees get in.
-- "Active" = is_active AND no termination_date. The rule lives in one function and is enforced in three places:
--   1. sign-up    : trigger on auth.users rejects emails that aren't active employees
--   2. every read : RLS on all ERP tables calls current_employee_id()
--   3. the app    : the Next.js server calls current_employee() on every request and signs out non-employees

-- ---------------------------------------------------------------- the rule
create or replace function public.is_active_employee_email(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employees e
    where lower(e.email) = lower(p_email) and e.is_active and e.termination_date is null
  )
$$;

-- employee_id of the signed-in user, or NULL (not signed in / not an employee / inactive / terminated).
-- Email is trustworthy here only because Supabase Auth requires a confirmed email to sign in.
create or replace function public.current_employee_id()
returns integer language sql stable security definer set search_path = '' as $$
  select e.employee_id from public.employees e
  where lower(e.email) = lower(auth.jwt() ->> 'email') and e.is_active and e.termination_date is null
$$;

-- Profile of the signed-in employee for the app header (NULL row when not allowed).
create or replace function public.current_employee()
returns table (employee_id integer, employee_code text, first_name text, last_name text, email text,
               job_title text, department text, hire_date date)
language sql stable security definer set search_path = '' as $$
  select e.employee_id, e.employee_code, e.first_name, e.last_name, e.email, e.job_title, d.name, e.hire_date
  from public.employees e join public.departments d using (department_id)
  where e.employee_id = public.current_employee_id()
$$;

-- Username sign-in: the app lets people type their employee code (E0001) instead of an email.
-- Returns the login email for an ACTIVE employee code, else NULL. Callable before sign-in (anon), so it reveals
-- only whether a code belongs to an active employee and that employee's work email: an accepted trade-off for
-- a company directory. Passwords are still checked by Supabase Auth, which rate-limits failed sign-ins.
create or replace function public.login_email_for(p_username text)
returns text language sql stable security definer set search_path = '' as $$
  select e.email from public.employees e
  where upper(e.employee_code) = upper(trim(p_username)) and e.is_active and e.termination_date is null
$$;

revoke execute on function public.login_email_for(text) from public;
grant execute on function public.login_email_for(text) to anon, authenticated;
revoke execute on function public.is_active_employee_email(text) from public, anon, authenticated;
revoke execute on function public.current_employee_id() from public, anon;
revoke execute on function public.current_employee() from public, anon;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.current_employee() to authenticated;

-- ---------------------------------------------------------------- 1. registration gate
create or replace function public.only_active_employees_sign_up()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null or not public.is_active_employee_email(new.email) then
    raise exception 'Only active A-Pro employees can register' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists only_active_employees_sign_up on auth.users;
create trigger only_active_employees_sign_up
  before insert or update of email on auth.users
  for each row execute function public.only_active_employees_sign_up();

-- ---------------------------------------------------------------- 2. RLS: active employees only
do $$
declare t text;
begin
  foreach t in array array[
    'company','departments','employees','warehouses','product_categories','suppliers','products','product_prices',
    'inventory_policies','supplier_products','customers','chart_of_accounts','sales_orders','sales_order_lines',
    'deliveries','sales_invoices','customer_payments','purchase_requisitions','purchase_requisition_lines','rfqs',
    'rfq_quotes','purchase_orders','purchase_order_lines','goods_receipts','goods_receipt_lines','supplier_invoices',
    'supplier_invoice_lines','supplier_payments','inventory_transactions','journal_entries','journal_lines']
  loop
    execute format('drop policy if exists "authenticated can read" on public.%I', t);
    execute format('create policy "active employees can read" on public.%I for select to authenticated
                    using ((select public.current_employee_id()) is not null)', t);
  end loop;
end $$;
