-- 024_call_session_contact_counts.sql
-- Agrégation des compteurs de contacts par séance (hub Combo).

create index if not exists idx_call_session_contacts_session_status
  on public.call_session_contacts (session_id, status);

create or replace function public.call_session_contact_counts(p_session_ids bigint[])
returns table (
  session_id bigint,
  total bigint,
  called bigint,
  skipped bigint,
  pending bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.session_id,
    count(*)::bigint as total,
    count(*) filter (where c.status = 'called')::bigint as called,
    count(*) filter (where c.status = 'skipped')::bigint as skipped,
    count(*) filter (where c.status = 'pending')::bigint as pending
  from public.call_session_contacts c
  where c.session_id = any (p_session_ids)
  group by c.session_id;
$$;

revoke all on function public.call_session_contact_counts(bigint[]) from public;
grant execute on function public.call_session_contact_counts(bigint[]) to service_role;
grant execute on function public.call_session_contact_counts(bigint[]) to authenticated;

comment on function public.call_session_contact_counts(bigint[]) is
  'Compte total/called/skipped/pending par séance pour le hub Combo.';
