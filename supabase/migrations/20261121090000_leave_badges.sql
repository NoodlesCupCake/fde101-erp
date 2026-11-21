-- Notification badges for the sidebar, counted in the database (same rules as everything else).
--   approvals: pending requests the signed-in user may decide (can_decide_leave), never their own
--   my_leave : decisions on my requests made after I last opened My leave

create table public.notification_reads (
  employee_id integer not null references public.employees(employee_id) on delete cascade,
  feed        text not null check (feed in ('my_leave')),
  seen_at     timestamptz not null default now(),
  primary key (employee_id, feed)
);
alter table public.notification_reads enable row level security;
revoke all on public.notification_reads from anon, authenticated;  -- only via the functions below

create or replace function public.badge_counts()
returns table (approvals integer, my_leave integer)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::integer from public.leave_requests r
     where r.status = 'PENDING' and r.employee_id <> public.current_employee_id() and public.can_decide_leave(r.request_id)),
    (select count(*)::integer from public.leave_requests r
     where r.employee_id = public.current_employee_id() and r.status in ('APPROVED', 'REJECTED')
       and r.decided_at > coalesce((select n.seen_at from public.notification_reads n
                                    where n.employee_id = public.current_employee_id() and n.feed = 'my_leave'), '-infinity'))
  where public.current_employee_id() is not null
$$;

create or replace function public.mark_seen(p_feed text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notification_reads (employee_id, feed, seen_at)
  select public.current_employee_id(), p_feed, now() where public.current_employee_id() is not null
  on conflict (employee_id, feed) do update set seen_at = excluded.seen_at
$$;

revoke execute on function public.badge_counts() from public, anon;
revoke execute on function public.mark_seen(text) from public, anon;
grant execute on function public.badge_counts() to authenticated;
grant execute on function public.mark_seen(text) to authenticated;
