-- 009_call_session_cockpit.sql
-- Cockpit prospection : date de rappel + flag ne pas rappeler (snapshot séance)

alter table public.call_session_contacts
  add column if not exists recall_at date,
  add column if not exists do_not_call boolean not null default false;

comment on column public.call_session_contacts.recall_at is
  'Date de rappel planifiée après un non-décroché / répondeur';
comment on column public.call_session_contacts.do_not_call is
  'Ne pas rappeler — synchronisé vers Contact.NPA__c si true au log';
