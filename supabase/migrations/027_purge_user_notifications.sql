-- 027_purge_user_notifications.sql
-- Usage: schedule this RPC from a cron job, or call it after GET
-- /api/notifications to remove notification rows older than the retention
-- window. It is SECURITY DEFINER and is executable by service_role only.

create or replace function public.purge_user_notifications(
  max_age_hours integer default 24
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.user_notifications
  where created_at < now() - max_age_hours * interval '1 hour';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke execute on function public.purge_user_notifications(integer) from public;
grant execute on function public.purge_user_notifications(integer) to service_role;

comment on function public.purge_user_notifications(integer) is
  'Deletes user_notifications rows older than max_age_hours; use from cron or after the notifications GET handler.';
