-- 012_call_session_contacts_email.sql
-- Persist contact email on session rows for list/fiche display (and future mailto).

alter table public.call_session_contacts
  add column if not exists email text;

comment on column public.call_session_contacts.email is
  'Email CRM du contact, copié à la création de séance pour affichage / mailto.';
