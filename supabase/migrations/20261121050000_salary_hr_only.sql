-- Role × action matrix: "see other salary" is HR only. Admins can still SET a salary (create/update),
-- but reading it back on the edit form now requires HR too.
create or replace function public.admin_employee_salary(p_employee_id integer)
returns numeric language sql stable security definer set search_path = '' as $$
  select e.monthly_salary from public.employees e
  where e.employee_id = p_employee_id and public.has_role('admin') and public.has_role('hr')
$$;
