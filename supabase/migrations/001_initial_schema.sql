-- 001_initial_schema.sql
-- Lot 0.2 — Supabase: tables, RLS, triggers

-- ============================================================
-- 1. profiles
-- ============================================================
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  sf_user_id text,
  role       text not null default 'commercial'
    check (role in ('commercial', 'manager')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- trigger: auto-create profile on first sign-up
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ============================================================
-- 2. settings
-- ============================================================
create table public.settings (
  id         bigint generated always as identity primary key,
  key        text not null unique,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 3. challenges
-- ============================================================
create table public.challenges (
  id         bigint generated always as identity primary key,
  title      text not null,
  metric     text not null,
  period     text not null default 'weekly'
    check (period in ('weekly', 'monthly', 'custom')),
  status     text not null default 'active'
    check (status in ('draft', 'active', 'archived')),
  creator    uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 4. challenge_results
-- ============================================================
create table public.challenge_results (
  id            bigint generated always as identity primary key,
  challenge_id  bigint not null references public.challenges(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  value         numeric not null default 0,
  rank          int,
  updated_at    timestamptz not null default now(),
  unique(challenge_id, profile_id)
);

-- ============================================================
-- 5. badges
-- ============================================================
create table public.badges (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  date       date not null default current_date,
  meta       jsonb default '{}'::jsonb
);

-- ============================================================
-- 6. action_journal
-- ============================================================
create table public.action_journal (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid not null references public.profiles(id),
  action_type text not null,
  changes     jsonb default '{}'::jsonb,
  targets     jsonb default '[]'::jsonb,
  result      jsonb default '{}'::jsonb
);

create index idx_action_journal_at on public.action_journal (at desc);
create index idx_action_journal_actor on public.action_journal (actor);

-- ============================================================
-- RLS: enable on all tables
-- ============================================================
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_results enable row level security;
alter table public.badges enable row level security;
alter table public.action_journal enable row level security;

-- ============================================================
-- RLS policies: read = authenticated, write = service-role only
-- ============================================================

-- profiles
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

create policy "profiles_insert" on public.profiles
  for insert to service_role with check (true);

create policy "profiles_update" on public.profiles
  for update to service_role using (true);

create policy "profiles_delete" on public.profiles
  for delete to service_role using (true);

-- settings
create policy "settings_select" on public.settings
  for select to authenticated using (true);

create policy "settings_insert" on public.settings
  for insert to service_role with check (true);

create policy "settings_update" on public.settings
  for update to service_role using (true);

create policy "settings_delete" on public.settings
  for delete to service_role using (true);

-- challenges
create policy "challenges_select" on public.challenges
  for select to authenticated using (true);

create policy "challenges_insert" on public.challenges
  for insert to service_role with check (true);

create policy "challenges_update" on public.challenges
  for update to service_role using (true);

create policy "challenges_delete" on public.challenges
  for delete to service_role using (true);

-- challenge_results
create policy "challenge_results_select" on public.challenge_results
  for select to authenticated using (true);

create policy "challenge_results_insert" on public.challenge_results
  for insert to service_role with check (true);

create policy "challenge_results_update" on public.challenge_results
  for update to service_role using (true);

create policy "challenge_results_delete" on public.challenge_results
  for delete to service_role using (true);

-- badges
create policy "badges_select" on public.badges
  for select to authenticated using (true);

create policy "badges_insert" on public.badges
  for insert to service_role with check (true);

create policy "badges_update" on public.badges
  for update to service_role using (true);

create policy "badges_delete" on public.badges
  for delete to service_role using (true);

-- action_journal
create policy "action_journal_select" on public.action_journal
  for select to authenticated using (true);

create policy "action_journal_insert" on public.action_journal
  for insert to service_role with check (true);

create policy "action_journal_update" on public.action_journal
  for update to service_role using (true);

create policy "action_journal_delete" on public.action_journal
  for delete to service_role using (true);
