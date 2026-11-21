-- Editable permissions. The role × action matrix now lives in a table, and every check in the database
-- asks has_permission('<action>') instead of a hard-coded role. Changing a cell takes effect on the next request.

create table public.role_permissions (
  role       text not null check (role in ('employee', 'manager', 'hr', 'admin')),
  permission text not null,
  allowed    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by integer references public.employees(employee_id),
  primary key (role, permission)
);
alter table public.role_permissions enable row level security;

-- Seed = the matrix from the workshop.
insert into public.role_permissions (role, permission, allowed)
select r, p, (r, p) in (
  ('employee','salary.read_own'), ('employee','leave.request'),
  ('manager','salary.read_own'), ('manager','leave.request'), ('manager','leave.approve_team'), ('manager','leave.approve_own_if_top'),
  ('hr','salary.read_own'), ('hr','salary.read_all'), ('hr','leave.request'), ('hr','leave.approve_any'),
  ('admin','salary.read_own'), ('admin','leave.request'), ('admin','users.manage'), ('admin','types.manage'), ('admin','permissions.manage'))
from unnest(array['employee','manager','hr','admin']) r,
     unnest(array['salary.read_own','salary.read_all','users.manage','types.manage','permissions.manage',
                  'leave.request','leave.approve_team','leave.approve_own_if_top','leave.approve_any']) p;

-- Does the signed-in employee hold this permission through ANY of their types? (types stack)
create or replace function public.has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_employee_id() is not null and exists (
    select 1 from public.role_permissions rp
    where rp.permission = p_permission and rp.allowed
      and rp.role = any (public.employee_types(public.current_employee_id())))
$$;
revoke execute on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

create or replace function public.my_permissions()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct rp.permission order by rp.permission), array[]::text[])
  from public.role_permissions rp
  where public.current_employee_id() is not null and rp.allowed
    and rp.role = any (public.employee_types(public.current_employee_id()))
$$;
revoke execute on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

-- Who may edit the matrix: holders of permissions.manage. Everyone signed in may read it.
create policy "active employees can read permissions" on public.role_permissions
  for select to authenticated using ((select public.current_employee_id()) is not null);
create policy "permission managers can edit" on public.role_permissions
  for update to authenticated using ((select public.has_permission('permissions.manage')))
  with check ((select public.has_permission('permissions.manage')));
grant select on public.role_permissions to authenticated;
grant update (allowed, updated_by) on public.role_permissions to authenticated;

-- Never lock everyone out: Admin always keeps permissions.manage.
create or replace function public.keep_permission_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'admin' and new.permission = 'permissions.manage' and not new.allowed then
    raise exception 'Admin must keep permissions.manage, or nobody could change permissions again' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger keep_permission_admin before update on public.role_permissions
  for each row execute function public.keep_permission_admin();

-- ---------------------------------------------------------------- salary checks -> permissions
create or replace function public.visible_salaries()
returns table (employee_id integer, monthly_salary numeric)
language sql stable security definer set search_path = '' as $$
  select e.employee_id, e.monthly_salary from public.employees e
  where public.current_employee_id() is not null
    and (public.has_permission('salary.read_all')
         or (e.employee_id = public.current_employee_id() and public.has_permission('salary.read_own')))
$$;

create or replace function public.admin_employee_salary(p_employee_id integer)
returns numeric language sql stable security definer set search_path = '' as $$
  select e.monthly_salary from public.employees e
  where e.employee_id = p_employee_id and public.has_permission('users.manage') and public.has_permission('salary.read_all')
$$;

-- Profile: own salary only with salary.read_own; also returns the caller's permissions.
drop function if exists public.current_employee();
create function public.current_employee()
returns table (employee_id integer, employee_code text, first_name text, last_name text, email text,
               job_title text, department text, department_code text, hire_date date, monthly_salary numeric,
               types text[], permissions text[], manager_code text, manager_name text, manager_title text)
language sql stable security definer set search_path = '' as $$
  select e.employee_id, e.employee_code, e.first_name, e.last_name, e.email, e.job_title, d.name, d.code, e.hire_date,
         case when public.has_permission('salary.read_own') then e.monthly_salary end,
         public.employee_types(e.employee_id), public.my_permissions(),
         m.employee_code, m.first_name || ' ' || m.last_name, m.job_title
  from public.employees e
  join public.departments d using (department_id)
  left join public.employees m on m.employee_id = e.manager_id
  where e.employee_id = public.current_employee_id()
$$;
revoke execute on function public.current_employee() from public, anon;
grant execute on function public.current_employee() to authenticated;

-- ---------------------------------------------------------------- type changes -> types.manage
drop policy "admins can grant types" on public.employee_roles;
drop policy "admins can revoke types" on public.employee_roles;
create policy "type managers can grant types" on public.employee_roles
  for insert to authenticated with check ((select public.has_permission('types.manage')));
create policy "type managers can revoke types" on public.employee_roles
  for delete to authenticated using ((select public.has_permission('types.manage')));

-- ---------------------------------------------------------------- user CRUD -> users.manage
create or replace function public.admin_create_employee(
  p_first_name text, p_last_name text, p_email text, p_department_id integer, p_job_title text,
  p_manager_id integer, p_monthly_salary numeric, p_hire_date date default current_date)
returns table (employee_id integer, employee_code text)
language plpgsql security definer set search_path = '' as $$
declare v_id integer; v_code text;
begin
  if not public.has_permission('users.manage') then raise exception 'Not allowed: users.manage' using errcode = '42501'; end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_last_name), '') = '' then raise exception 'Name is required'; end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid email'; end if;
  if exists (select 1 from public.employees e where lower(e.email) = lower(trim(p_email))) then raise exception 'Email already used by another employee'; end if;
  if p_monthly_salary is null or p_monthly_salary < 0 then raise exception 'Salary must be zero or more'; end if;
  perform public._admin_check_manager(null, p_manager_id);

  lock table public.employees in share row exclusive mode;  -- serialize id/code generation
  select coalesce(max(e.employee_id), 0) + 1 into v_id from public.employees e;
  v_code := 'E' || lpad(v_id::text, 4, '0');
  insert into public.employees (employee_id, employee_code, first_name, last_name, email, department_id, job_title,
                                manager_id, hire_date, termination_date, monthly_salary, is_active)
  values (v_id, v_code, trim(p_first_name), trim(p_last_name), lower(trim(p_email)), p_department_id, trim(p_job_title),
          p_manager_id, coalesce(p_hire_date, current_date), null, p_monthly_salary, true);
  return query select v_id, v_code;
end $$;

-- p_monthly_salary NULL = keep the current salary
create or replace function public.admin_update_employee(
  p_employee_id integer, p_first_name text, p_last_name text, p_email text, p_department_id integer,
  p_job_title text, p_manager_id integer, p_monthly_salary numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission('users.manage') then raise exception 'Not allowed: users.manage' using errcode = '42501'; end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_last_name), '') = '' then raise exception 'Name is required'; end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid email'; end if;
  if exists (select 1 from public.employees e where lower(e.email) = lower(trim(p_email)) and e.employee_id <> p_employee_id) then
    raise exception 'Email already used by another employee';
  end if;
  if p_monthly_salary is not null and p_monthly_salary < 0 then raise exception 'Salary must be zero or more'; end if;
  perform public._admin_check_manager(p_employee_id, p_manager_id);
  update public.employees set
    first_name = trim(p_first_name), last_name = trim(p_last_name), email = lower(trim(p_email)),
    department_id = p_department_id, job_title = trim(p_job_title), manager_id = p_manager_id,
    monthly_salary = coalesce(p_monthly_salary, monthly_salary)
  where employee_id = p_employee_id;
  if not found then raise exception 'Employee not found'; end if;
end $$;

-- Terminate (soft delete). Their direct reports move up to the terminated employee's own manager.
create or replace function public.admin_terminate_employee(p_employee_id integer, p_date date default current_date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mgr integer;
begin
  if not public.has_permission('users.manage') then raise exception 'Not allowed: users.manage' using errcode = '42501'; end if;
  if p_employee_id = public.current_employee_id() then raise exception 'You cannot terminate yourself'; end if;
  select manager_id into v_mgr from public.employees where employee_id = p_employee_id and is_active;
  if not found then raise exception 'Employee not found or already terminated'; end if;
  update public.employees set manager_id = v_mgr where manager_id = p_employee_id and is_active;
  update public.employees set is_active = false, termination_date = coalesce(p_date, current_date) where employee_id = p_employee_id;
  delete from public.employee_roles where employee_id = p_employee_id and role <> 'admin';
  delete from public.employee_roles where employee_id = p_employee_id and role = 'admin';  -- keep_one_admin still applies
end $$;

create or replace function public.admin_reactivate_employee(p_employee_id integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission('users.manage') then raise exception 'Not allowed: users.manage' using errcode = '42501'; end if;
  update public.employees set is_active = true, termination_date = null where employee_id = p_employee_id;
  if not found then raise exception 'Employee not found'; end if;
end $$;

