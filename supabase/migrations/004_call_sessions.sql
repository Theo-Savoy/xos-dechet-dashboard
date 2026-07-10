-- 004_call_sessions.sql
-- Lot 4.A — Call Manager: séances de prospection téléphonique

-- ============================================================
-- 1. call_sessions
-- ============================================================
create table public.call_sessions (
  id           bigint generated always as identity primary key,
  owner        uuid not null references public.profiles(id) on delete cascade,
  name         text not null,
  status       text not null default 'active' check (status in ('active','completed')),
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index idx_call_sessions_owner on public.call_sessions (owner, created_at desc);

-- ============================================================
-- 2. call_session_contacts
-- ============================================================
create table public.call_session_contacts (
  id             bigint generated always as identity primary key,
  session_id     bigint not null references public.call_sessions(id) on delete cascade,
  position       int not null,
  sf_contact_id  text not null,
  sf_account_id  text,
  contact_name   text not null,
  account_name   text,
  phone          text,
  status         text not null default 'pending' check (status in ('pending','called','skipped')),
  outcome        text,
  comments       text,
  sf_task_id     text,
  called_at      timestamptz
);
create index idx_call_session_contacts_session on public.call_session_contacts (session_id, position);

-- ============================================================
-- RLS: enable on both tables
-- ============================================================
alter table public.call_sessions enable row level security;
alter table public.call_session_contacts enable row level security;

-- ============================================================
-- RLS policies: read = authenticated, write = service-role only
-- ============================================================

-- call_sessions
create policy "call_sessions_select" on public.call_sessions
  for select to authenticated using (true);

create policy "call_sessions_insert" on public.call_sessions
  for insert to service_role with check (true);

create policy "call_sessions_update" on public.call_sessions
  for update to service_role using (true);

create policy "call_sessions_delete" on public.call_sessions
  for delete to service_role using (true);

-- call_session_contacts
create policy "call_session_contacts_select" on public.call_session_contacts
  for select to authenticated using (true);

create policy "call_session_contacts_insert" on public.call_session_contacts
  for insert to service_role with check (true);

create policy "call_session_contacts_update" on public.call_session_contacts
  for update to service_role using (true);

create policy "call_session_contacts_delete" on public.call_session_contacts
  for delete to service_role using (true);
