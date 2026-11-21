-- Supabase grants ALL on new public tables to anon/authenticated by default. RLS already blocks writes
-- (no write policies), but remove the privileges too so writes can only happen through submit/decide/cancel_leave().
revoke insert, update, delete, truncate on public.leave_requests, public.leave_types, public.role_permissions from anon, authenticated;
revoke all on public.leave_requests, public.leave_types, public.public_holidays from anon;
revoke update, truncate on public.public_holidays from authenticated;
grant update (allowed, updated_by) on public.role_permissions to authenticated;
