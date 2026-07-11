-- 014_sf_user_map_roles.sql
-- Bootstrap des rôles au signup : le rôle tenant vit dans sf_user_map (email → sf_user_id + role).
-- Corrige aussi les profils existants restés sur le défaut 'commercial'.
-- Appliquée en prod (xos-portal) le 2026-07-11 via MCP, précédée d'un rattrapage :
-- la contrainte de 008 (ajout du rôle admin) n'avait jamais été appliquée en prod.

-- Rattrapage 008 (idempotent).
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('commercial', 'manager', 'admin'));

alter table public.sf_user_map
  add column if not exists role text not null default 'commercial';
alter table public.sf_user_map
  drop constraint if exists sf_user_map_role_check;
alter table public.sf_user_map
  add constraint sf_user_map_role_check check (role in ('commercial', 'manager', 'admin'));

update public.sf_user_map set role = 'admin' where email = 'theo.savoy@xos-learning.fr';
update public.sf_user_map set role = 'manager' where email in ('jerome.bosio@xos-learning.fr', 'paul.rathouin@xos-learning.fr');

-- Trigger : sf_user_id ET role depuis la table de correspondance.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  mapped record;
begin
  if new.email !~ '@xos-learning\.fr$' then
    raise exception 'Email domain not allowed: %', new.email;
  end if;

  select m.sf_user_id, m.role into mapped
  from public.sf_user_map m
  where lower(m.email) = lower(new.email);

  insert into public.profiles (id, email, full_name, sf_user_id, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    mapped.sf_user_id,
    coalesce(mapped.role, 'commercial')
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- Backfill : élève les profils existants restés sur le défaut (jamais l'inverse).
update public.profiles p
set role = m.role
from public.sf_user_map m
where lower(p.email) = lower(m.email)
  and p.role = 'commercial'
  and m.role <> 'commercial';
