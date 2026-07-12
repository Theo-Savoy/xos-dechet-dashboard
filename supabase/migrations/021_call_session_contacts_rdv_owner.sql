-- 021_call_session_contacts_rdv_owner.sql
-- Denormalise le propriétaire Salesforce du RDV (Event OwnerId)
-- pour le cockpit manager (attribution SDR → commercial).

alter table public.call_session_contacts
  add column if not exists rdv_owner_sf_user_id text;

comment on column public.call_session_contacts.rdv_owner_sf_user_id is
  'Salesforce User Id propriétaire de l''Event RDV (peut différer du créateur de séance).';
