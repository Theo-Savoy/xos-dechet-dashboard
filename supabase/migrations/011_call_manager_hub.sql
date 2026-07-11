-- Hub Call Manager : types de séance, compteur de tentatives, NPA local pour KPIs.

alter table public.call_sessions
  add column if not exists session_type text not null default 'prospection';

alter table public.call_sessions
  drop constraint if exists call_sessions_session_type_check;

alter table public.call_sessions
  add constraint call_sessions_session_type_check
  check (session_type in ('prospection', 'suivi_opportunites', 'suivi_clients', 'relance'));

comment on column public.call_sessions.session_type is
  'Type de séance : prospection | suivi_opportunites | suivi_clients | relance';

alter table public.call_session_contacts
  add column if not exists attempt_count integer not null default 0,
  add column if not exists marked_npa boolean not null default false;

alter table public.call_session_contacts
  drop constraint if exists call_session_contacts_attempt_count_check;

alter table public.call_session_contacts
  add constraint call_session_contacts_attempt_count_check
  check (attempt_count >= 0);

comment on column public.call_session_contacts.attempt_count is
  'Tentatives de contact (incrémenté seulement si on a essayé de joindre ; pending ne compte pas)';

comment on column public.call_session_contacts.marked_npa is
  'NPA coché au log (snapshot local pour KPIs ; SF reste la source NPA__c)';
