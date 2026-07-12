-- 022_call_session_sharing.sql
-- Séances partagées : membres, attribution au logger, soft-claim pending.

create table if not exists public.call_session_members (
  session_id bigint not null references public.call_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create index if not exists idx_call_session_members_user
  on public.call_session_members (user_id, session_id);

alter table public.call_session_members enable row level security;

create policy "call_session_members_select" on public.call_session_members
  for select to authenticated using (true);

create policy "call_session_members_insert" on public.call_session_members
  for insert to service_role with check (true);

create policy "call_session_members_update" on public.call_session_members
  for update to service_role using (true);

create policy "call_session_members_delete" on public.call_session_members
  for delete to service_role using (true);

alter table public.call_session_contacts
  add column if not exists logged_by uuid references public.profiles(id) on delete set null,
  add column if not exists claimed_by uuid references public.profiles(id) on delete set null,
  add column if not exists claimed_at timestamptz;

comment on column public.call_session_contacts.logged_by is
  'Profil qui a journalisé l''appel (KPI Combo).';
comment on column public.call_session_contacts.claimed_by is
  'Profil qui a réservé le contact pending (soft lock).';
comment on column public.call_session_contacts.claimed_at is
  'Horodatage du soft-claim (TTL géré côté API).';

create index if not exists idx_call_session_contacts_logged_by
  on public.call_session_contacts (logged_by, called_at desc);
create index if not exists idx_call_session_contacts_claimed_by
  on public.call_session_contacts (claimed_by)
  where claimed_by is not null;
