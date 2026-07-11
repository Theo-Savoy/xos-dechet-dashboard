-- 013_sf_user_map.sql
-- Attribution multi-users : correspondance email de login → User Salesforce.
-- Le trigger handle_new_user mappe sf_user_id dès la création du profil.
-- Appliquée en prod (xos-portal) le 2026-07-11 via MCP.

create table if not exists public.sf_user_map (
  email text primary key,
  sf_user_id text not null
);

-- Service-role uniquement : RLS activée sans policy.
alter table public.sf_user_map enable row level security;

insert into public.sf_user_map (email, sf_user_id) values
  ('theo.savoy@xos-learning.fr', '005AZ000000X5nDYAS'),
  ('paul.rathouin@xos-learning.fr', '005AZ000000fLYkYAM'),
  ('christophe.hirtz@xos-learning.fr', '0055I000002lY9QQAU'),
  ('yanis.agharbi@xos-learning.fr', '005Sb000007b6dWIAQ'),
  ('jerome.bosio@xos-learning.fr', '005b0000005zfnvAAA')
on conflict (email) do update set sf_user_id = excluded.sf_user_id;

-- Recrée le trigger en préservant la validation de domaine (002) : ajout du lookup sf_user_id.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.email !~ '@xos-learning\.fr$' then
    raise exception 'Email domain not allowed: %', new.email;
  end if;

  insert into public.profiles (id, email, full_name, sf_user_id)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    (select m.sf_user_id from public.sf_user_map m where lower(m.email) = lower(new.email))
  );
  return new;
end;
$$;

-- Même durcissement que 003.
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- Backfill des profils existants non mappés.
update public.profiles p
set sf_user_id = m.sf_user_id
from public.sf_user_map m
where p.sf_user_id is null and lower(p.email) = lower(m.email);
