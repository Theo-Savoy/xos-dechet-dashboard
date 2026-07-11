-- Cockpit prospection : date de rappel (snapshot séance).
-- NPA : écrit uniquement sur Contact.NPA__c dans Salesforce au log, pas de colonne locale.

alter table public.call_session_contacts
  add column if not exists recall_at date;

comment on column public.call_session_contacts.recall_at is
  'Date de rappel planifiée après un non-décroché / répondeur';
