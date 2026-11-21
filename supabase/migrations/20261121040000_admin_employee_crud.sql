-- Admin CRUD on employees. All writes go through these functions, which check has_role('admin') themselves,
-- so the rule holds even if someone calls the API directly. "Delete" is a soft delete (terminate):
-- sales orders, journal entries etc. still reference the employee, and history must not disappear.

create or replace function public._admin_check_manager(p_employee_id integer, p_manager_id integer)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_manager_id is null then return; end if;
  if p_manager_id = p_employee_id then raise exception 'An employee cannot report to themselves'; end if;
  if not exists (select 1 from public.employees where employee_id = p_manager_id and is_active and termination_date is null) then
    raise exception 'Manager must be an active employee';
  end if;
  -- no cycles: walking up from the new manager must never reach this employee
  if p_employee_id is not null and exists (
    with recursive up(id) as (
      select p_manager_id
      union
      select e.manager_id from public.employees e join up on e.employee_id = up.id where e.manager_id is not null
    ) select 1 from up where id = p_employee_id
  ) then
    raise exception 'That would create a reporting loop';
  end if;
end $$;

create or replace function public.admin_create_employee(
  p_first_name text, p_last_name text, p_email text, p_department_id integer, p_job_title text,
  p_manager_id integer, p_monthly_salary numeric, p_hire_date date default current_date)
returns table (employee_id integer, employee_code text)
language plpgsql security definer set search_path = '' as $$
declare v_id integer; v_code text;
begin
  if not public.has_role('admin') then raise exception 'Admins only' using errcode = '42501'; end if;
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
  if not public.has_role('admin') then raise exception 'Admins only' using errcode = '42501'; end if;
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
  if not public.has_role('admin') then raise exception 'Admins only' using errcode = '42501'; end if;
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
  if not public.has_role('admin') then raise exception 'Admins only' using errcode = '42501'; end if;
  update public.employees set is_active = true, termination_date = null where employee_id = p_employee_id;
  if not found then raise exception 'Employee not found'; end if;
end $$;

-- Admins edit salaries, so they may read them on the edit form (HR still sees them everywhere).
create or replace function public.admin_employee_salary(p_employee_id integer)
returns numeric language sql stable security definer set search_path = '' as $$
  select e.monthly_salary from public.employees e where e.employee_id = p_employee_id and public.has_role('admin')
$$;

revoke execute on function public._admin_check_manager(integer, integer) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_create_employee(text, text, text, integer, text, integer, numeric, date)',
    'public.admin_update_employee(integer, text, text, text, integer, text, integer, numeric)',
    'public.admin_terminate_employee(integer, date)',
    'public.admin_reactivate_employee(integer)',
    'public.admin_employee_salary(integer)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
