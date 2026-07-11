-- Lot 8.1b — liaison OAuth Salesforce par utilisateur.
-- Les refresh tokens sont chiffrés côté serveur (AES-256-GCM) avant stockage.
-- Appliquée en prod (xos-portal) le 2026-07-11 via `supabase db query --linked`.

alter table public.profiles
  add column if not exists sf_refresh_token_encrypted text,
  add column if not exists sf_auth_connected_at timestamptz,
  add column if not exists sf_oauth_state_hash text,
  add column if not exists sf_oauth_state_expires_at timestamptz;

create unique index if not exists profiles_sf_oauth_state_hash_idx
  on public.profiles (sf_oauth_state_hash)
  where sf_oauth_state_hash is not null;

comment on column public.profiles.sf_refresh_token_encrypted is
  'Refresh token Salesforce chiffré AES-256-GCM ; jamais exposé via le client anon.';

-- RLS filtre les lignes, pas les colonnes : retirer les secrets de la surface
-- PostgREST authentifiée, tout en conservant les champs de profil lisibles.
revoke select on public.profiles from anon, authenticated;
grant select (
  id, email, full_name, sf_user_id, role, created_at, updated_at,
  sf_auth_connected_at
) on public.profiles to authenticated;
