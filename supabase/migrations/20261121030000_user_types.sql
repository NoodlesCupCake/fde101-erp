-- User types. One person can hold several at once (e.g. E0057 is a Manager AND HR).
--   employee : DERIVED  every active employee (the base type)
--   manager  : DERIVED  has at least one active subordinate (employees.manager_id points to them).
--                       Changing it = changing the reporting line, not flipping a flag.
--   hr       : STORED   in employee_roles. Seeded from the HR department (code HRA); admins can change it.
--   admin    : STORED   in employee_roles. Can create/delete login accounts and change types.

-- ---------------------------------------------------------------- stored types
create table public.employee_roles (
  employee_id integer not null references public.employees(employee_id) on delete cascade,
  role        text    not null check (role in ('hr', 'admin')),
  granted_at  timestamptz not null default now(),
  granted_by  integer references public.employees(employee_id),
  primary key (employee_id, role)
);
alter table public.employee_roles enable row level security;

insert into public.employee_roles (employee_id, role)
select e.employee_id, 'hr' from public.employees e join public.departments d using (department_id)
where d.code = 'HRA' and e.is_active;

-- Admins: the Admin Officers in HR & Admin, plus the Managing Director.
insert into public.employee_roles (employee_id, role)
select employee_id, 'admin' from public.employees
where is_active and (job_title = 'Admin Officer' or employee_code = 'E0001');

-- ---------------------------------------------------------------- helpers
create or replace function public.has_role(p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employee_roles r
                 where r.employee_id = public.current_employee_id() and r.role = p_role)
$$;

create or replace function public.employee_types(p_employee_id integer)
returns text[] language sql stable security definer set search_path = '' as $$
  select array['employee']
    || case when exists (select 1 from public.employees s where s.manager_id = p_employee_id and s.is_active)
            then array['manager'] else array[]::text[] end
    || coalesce((select array_agg(r.role order by r.role) from public.employee_roles r
                 where r.employee_id = p_employee_id), array[]::text[])
$$;

revoke execute on function public.has_role(text) from public, anon;
revoke execute on function public.employee_types(integer) from public, anon;
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.employee_types(integer) to authenticated;

-- Profile of the signed-in employee: now with types, reporting manager and OWN salary.
drop function if exists public.current_employee();
create function public.current_employee()
returns table (employee_id integer, employee_code text, first_name text, last_name text, email text,
               job_title text, department text, department_code text, hire_date date, monthly_salary numeric,
               types text[], manager_code text, manager_name text, manager_title text)
language sql stable security definer set search_path = '' as $$
  select e.employee_id, e.employee_code, e.first_name, e.last_name, e.email, e.job_title, d.name, d.code,
         e.hire_date, e.monthly_salary, public.employee_types(e.employee_id),
         m.employee_code, m.first_name || ' ' || m.last_name, m.job_title
  from public.employees e
  join public.departments d using (department_id)
  left join public.employees m on m.employee_id = e.manager_id
  where e.employee_id = public.current_employee_id()
$$;
revoke execute on function public.current_employee() from public, anon;
grant execute on function public.current_employee() to authenticated;

-- ---------------------------------------------------------------- salary: column-level privacy
-- RLS works per ROW, so it can't hide one column. Remove the column from what signed-in users can SELECT.
revoke select on public.employees from anon, authenticated;
grant select (employee_id, employee_code, first_name, last_name, email, department_id, job_title, manager_id,
              hire_date, termination_date, is_active) on public.employees to authenticated;

-- The only way to read salaries: your own, or everyone's if you are HR.
create or replace function public.visible_salaries()
returns table (employee_id integer, monthly_salary numeric)
language sql stable security definer set search_path = '' as $$
  select e.employee_id, e.monthly_salary from public.employees e
  where public.current_employee_id() is not null
    and (public.has_role('hr') or e.employee_id = public.current_employee_id())
$$;
revoke execute on function public.visible_salaries() from public, anon;
grant execute on function public.visible_salaries() to authenticated;

-- ---------------------------------------------------------------- who can change types
create policy "active employees can read types" on public.employee_roles
  for select to authenticated using ((select public.current_employee_id()) is not null);
create policy "admins can grant types" on public.employee_roles
  for insert to authenticated with check ((select public.has_role('admin')));
create policy "admins can revoke types" on public.employee_roles
  for delete to authenticated using ((select public.has_role('admin')));
grant select, insert, delete on public.employee_roles to authenticated;

-- Never lock everyone out: the last admin can't be removed.
create or replace function public.keep_one_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and not exists (select 1 from public.employee_roles
                                        where role = 'admin' and employee_id <> old.employee_id) then
    raise exception 'Cannot remove the last admin' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger keep_one_admin before delete on public.employee_roles
  for each row execute function public.keep_one_admin();
