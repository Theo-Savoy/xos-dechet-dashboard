-- 006_call_session_contacts_sf_event_id.sql
-- Lot v2.B — persist Salesforce Event id after RDV scheduling

alter table public.call_session_contacts
  add column if not exists sf_event_id text;
