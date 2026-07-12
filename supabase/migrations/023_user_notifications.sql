-- 023_user_notifications.sql
-- Centre de contrôle : notifications utilisateur (ex. RDV attribué).

create table if not exists public.user_notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists idx_user_notifications_recipient_unread
  on public.user_notifications (recipient_id, created_at desc)
  where read_at is null;

create index if not exists idx_user_notifications_recipient
  on public.user_notifications (recipient_id, created_at desc);

alter table public.user_notifications enable row level security;

create policy "user_notifications_select" on public.user_notifications
  for select to authenticated using (recipient_id = auth.uid());

create policy "user_notifications_update" on public.user_notifications
  for update to authenticated using (recipient_id = auth.uid());

create policy "user_notifications_insert" on public.user_notifications
  for insert to service_role with check (true);

create policy "user_notifications_delete" on public.user_notifications
  for delete to service_role using (true);

comment on table public.user_notifications is
  'Notifications OS (control center) — destinataire = profiles.id.';
