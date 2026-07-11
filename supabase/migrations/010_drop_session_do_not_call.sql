-- 010_drop_session_do_not_call.sql
-- NPA = source de vérité Salesforce (Contact.NPA__c), pas de snapshot local.

alter table public.call_session_contacts
  drop column if exists do_not_call;
