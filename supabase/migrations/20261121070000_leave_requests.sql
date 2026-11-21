-- Leave requests: the first feature that WRITES data. Every write goes through a function that enforces the rules,
-- so they hold even when someone calls the API directly. Signed-in users can only SELECT (RLS) and call functions.
--
-- Decisions (written down as constraints / checks below):
--   * Types (Thai Labour Protection Act minimums): ANNUAL 6 days/yr, SICK 30 days/yr, PERSONAL 3 days/yr.
--   * Dates in the past: not allowed, except SICK leave, which may start up to 30 days back (you file it after being sick).
--   * Overlap: a new request may not overlap your own PENDING or APPROVED requests (any type, incl. half days).
--   * Half days: only for single-day requests (AM or PM) and count as 0.5.
--   * Weekends (Sat/Sun) and Thai public holidays (public_holidays) are not counted. A request with 0 working days is rejected.
--   * One calendar year per request (balances are per year). Split a request that crosses New Year.
--   * Balance is COMPUTED, never stored: entitlement - approved - pending in that year. PENDING days are reserved,
--     so you can't over-book by submitting many requests at once. Nothing can drift out of sync.
--   * Approver (Workshop 1.4 matrix, via has_permission):
--       - leave.approve_team: the requester's direct manager (employees.manager_id)
--       - leave.approve_any: HR, any request EXCEPT their own
--       - leave.approve_own_if_top: your own request only if you have no superior (manager_id is null, e.g. E0001)
--     Nobody else can decide, and nobody approves their own request unless they're at the top.

-- ---------------------------------------------------------------- reference data
create table public.leave_types (
  code            text primary key,
  name            text not null,
  days_per_year   numeric(4,1) not null check (days_per_year >= 0),
  max_past_days   integer not null default 0 check (max_past_days >= 0)
);
insert into public.leave_types values
  ('ANNUAL', 'Annual leave', 6, 0),
  ('SICK', 'Sick leave', 30, 30),
  ('PERSONAL', 'Personal business leave', 3, 0);

create table public.public_holidays (
  holiday_date date primary key,
  name         text not null
);
-- Fixed-date Thai public holidays; lunar ones (Makha/Visakha/Asarnha Bucha) change every year: HR adds them.
insert into public.public_holidays (holiday_date, name)
select make_date(y, m, d), n
from unnest(array[2026, 2027]) y,
     (values (1, 1, 'New Year''s Day'), (4, 6, 'Chakri Memorial Day'), (4, 13, 'Songkran'), (4, 14, 'Songkran'),
             (4, 15, 'Songkran'), (5, 1, 'National Labour Day'), (5, 4, 'Coronation Day'),
             (6, 3, 'Queen Suthida''s Birthday'), (7, 28, 'King Vajiralongkorn''s Birthday'),
             (8, 12, 'Queen Mother''s Birthday / Mother''s Day'), (10, 13, 'King Bhumibol Memorial Day'),
             (10, 23, 'Chulalongkorn Day'), (12, 5, 'King Bhumibol''s Birthday / Father''s Day'),
             (12, 10, 'Constitution Day'), (12, 31, 'New Year''s Eve')) h(m, d, n);

-- ---------------------------------------------------------------- requests
create table public.leave_requests (
  request_id       bigint generated always as identity primary key,
  employee_id      integer not null references public.employees(employee_id),
  leave_type       text not null references public.leave_types(code),
  start_date       date not null,
  end_date         date not null,
  half_day         text check (half_day in ('AM', 'PM')),
  days             numeric(4,1) not null check (days > 0),
  reason           text not null check (length(trim(reason)) between 1 and 500),
  status           text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  decided_by       integer references public.employees(employee_id),
  decided_at       timestamptz,
  decision_comment text check (decision_comment is null or length(decision_comment) <= 500),
  created_at       timestamptz not null default now(),
  check (end_date >= start_date),
  check (half_day is null or start_date = end_date),
  check (extract(year from start_date) = extract(year from end_date)),
  check ((status in ('APPROVED', 'REJECTED')) = (decided_by is not null)),
  check (status <> 'REJECTED' or length(trim(coalesce(decision_comment, ''))) > 0)
);
create index ix_leave_employee on public.leave_requests (employee_id, start_date);
create index ix_leave_pending on public.leave_requests (status) where status = 'PENDING';
alter table public.leave_types enable row level security;
alter table public.public_holidays enable row level security;
alter table public.leave_requests enable row level security;

-- ---------------------------------------------------------------- helpers
create or replace function public.leave_working_days(p_start date, p_end date, p_half_day text)
returns numeric language sql stable security definer set search_path = '' as $$
  select (count(*) * case when p_half_day is null then 1 else 0.5 end)::numeric
  from generate_series(p_start, p_end, interval '1 day') g(d)
  where extract(isodow from g.d) < 6
    and not exists (select 1 from public.public_holidays h where h.holiday_date = g.d::date)
$$;

create or replace function public._leave_balance(p_employee_id integer, p_type text, p_year integer)
returns table (entitled numeric, used numeric, pending numeric, remaining numeric)
language sql stable security definer set search_path = '' as $$
  select t.days_per_year,
         coalesce(sum(r.days) filter (where r.status = 'APPROVED'), 0),
         coalesce(sum(r.days) filter (where r.status = 'PENDING'), 0),
         t.days_per_year - coalesce(sum(r.days) filter (where r.status in ('APPROVED', 'PENDING')), 0)
  from public.leave_types t
  left join public.leave_requests r on r.leave_type = t.code and r.employee_id = p_employee_id
       and extract(year from r.start_date) = p_year
  where t.code = p_type
  group by t.days_per_year
$$;

-- The one place that decides "may the signed-in user approve/reject this request?"
create or replace function public.can_decide_leave(p_request_id bigint)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare me integer := public.current_employee_id(); r record;
begin
  if me is null then return false; end if;
  select lr.employee_id, e.manager_id into r
  from public.leave_requests lr join public.employees e using (employee_id) where lr.request_id = p_request_id;
  if not found then return false; end if;
  if r.employee_id = me then  -- your own request
    return r.manager_id is null and public.has_permission('leave.approve_own_if_top');
  end if;
  return public.has_permission('leave.approve_any')
      or (public.has_permission('leave.approve_team') and r.manager_id = me);
end $$;

-- ---------------------------------------------------------------- read access (RLS)
create policy "active employees read leave types" on public.leave_types
  for select to authenticated using ((select public.current_employee_id()) is not null);
create policy "active employees read holidays" on public.public_holidays
  for select to authenticated using ((select public.current_employee_id()) is not null);
-- Own requests; your direct reports' if you approve for your team; everyone's if you approve any (HR).
create policy "see own, team or all leave" on public.leave_requests
  for select to authenticated using (
    employee_id = (select public.current_employee_id())
    or ((select public.has_permission('leave.approve_any')))
    or ((select public.has_permission('leave.approve_team'))
        and exists (select 1 from public.employees e where e.employee_id = leave_requests.employee_id
                    and e.manager_id = (select public.current_employee_id()))));
grant select on public.leave_types, public.public_holidays, public.leave_requests to authenticated;
-- no insert/update/delete grants: writes only through the functions below

-- HR (leave.approve_any) maintains the holiday calendar.
create policy "leave admins manage holidays" on public.public_holidays
  for all to authenticated using ((select public.has_permission('leave.approve_any')))
  with check ((select public.has_permission('leave.approve_any')));
grant insert, delete on public.public_holidays to authenticated;

-- ---------------------------------------------------------------- writes
create or replace function public.submit_leave(p_type text, p_start date, p_end date, p_half_day text, p_reason text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  me integer := public.current_employee_id();
  t public.leave_types%rowtype;
  v_days numeric;
  v_left numeric;
  v_id bigint;
begin
  if me is null then raise exception 'Sign in as an active employee' using errcode = '42501'; end if;
  if not public.has_permission('leave.request') then raise exception 'Not allowed: leave.request' using errcode = '42501'; end if;
  select * into t from public.leave_types where code = p_type;
  if not found then raise exception 'Unknown leave type'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'End date must be on or after the start date'; end if;
  if extract(year from p_start) <> extract(year from p_end) then raise exception 'A request can''t cross New Year: split it into two'; end if;
  if p_start < current_date - t.max_past_days then
    raise exception '%', case when t.max_past_days = 0 then t.name || ' can''t start in the past'
                              else t.name || ' can start at most ' || t.max_past_days || ' days ago' end;
  end if;
  if p_half_day is not null and p_half_day not in ('AM', 'PM') then raise exception 'Half day must be AM or PM'; end if;
  if p_half_day is not null and p_start <> p_end then raise exception 'Half days are only for single-day requests'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;

  v_days := public.leave_working_days(p_start, p_end, p_half_day);
  if v_days = 0 then raise exception 'Those dates are all weekends or public holidays'; end if;

  perform 1 from public.employees where employee_id = me for update;  -- serialize this employee's submissions
  if exists (select 1 from public.leave_requests r where r.employee_id = me and r.status in ('PENDING', 'APPROVED')
             and daterange(r.start_date, r.end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'Overlaps another pending or approved request of yours';
  end if;
  select remaining into v_left from public._leave_balance(me, p_type, extract(year from p_start)::integer);
  if v_days > v_left then
    raise exception 'Not enough % left: % day(s) requested, % remaining (pending requests count)', lower(t.name), v_days, v_left;
  end if;

  insert into public.leave_requests (employee_id, leave_type, start_date, end_date, half_day, days, reason)
  values (me, p_type, p_start, p_end, p_half_day, v_days, trim(p_reason))
  returning request_id into v_id;
  return v_id;
end $$;

create or replace function public.decide_leave(p_request_id bigint, p_approve boolean, p_comment text)
returns void language plpgsql security definer set search_path = '' as $$
declare me integer := public.current_employee_id(); r public.leave_requests%rowtype;
begin
  select * into r from public.leave_requests where request_id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not public.can_decide_leave(p_request_id) then
    raise exception '%', case when r.employee_id = me then 'You can''t approve your own request'
                              else 'You are not an approver for this request' end using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then raise exception 'Only pending requests can be decided (this one is %)', lower(r.status); end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Add a comment when rejecting'; end if;
  update public.leave_requests
  set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
      decided_by = me, decided_at = now(), decision_comment = nullif(trim(coalesce(p_comment, '')), '')
  where request_id = p_request_id;
end $$;

create or replace function public.cancel_leave(p_request_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare me integer := public.current_employee_id(); r public.leave_requests%rowtype;
begin
  select * into r from public.leave_requests where request_id = p_request_id for update;
  if not found or r.employee_id is distinct from me then raise exception 'Request not found' using errcode = '42501'; end if;
  if r.status <> 'PENDING' then raise exception 'Only pending requests can be cancelled'; end if;
  update public.leave_requests set status = 'CANCELLED' where request_id = p_request_id;
end $$;

-- Balances for the signed-in employee (computed).
create or replace function public.my_leave_balances(p_year integer default extract(year from current_date)::integer)
returns table (leave_type text, name text, entitled numeric, used numeric, pending numeric, remaining numeric)
language sql stable security definer set search_path = '' as $$
  select t.code, t.name, b.entitled, b.used, b.pending, b.remaining
  from public.leave_types t
  cross join lateral public._leave_balance(public.current_employee_id(), t.code, p_year) b
  where public.current_employee_id() is not null
  order by t.code
$$;

revoke execute on function public.leave_working_days(date, date, text) from public, anon;
revoke execute on function public._leave_balance(integer, text, integer) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.leave_working_days(date, date, text)', 'public.can_decide_leave(bigint)',
    'public.submit_leave(text, date, date, text, text)', 'public.decide_leave(bigint, boolean, text)',
    'public.cancel_leave(bigint)', 'public.my_leave_balances(integer)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
