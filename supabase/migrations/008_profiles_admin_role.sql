-- 008_profiles_admin_role.sql
-- Trois rôles produit : commercial < manager < admin
-- Les emails bootstrap XOS sont documentés dans api/_config/access.js
-- (config tenant, pas du cœur produit).

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('commercial', 'manager', 'admin'));

comment on column public.profiles.role is
  'commercial | manager | admin — hiérarchie d''accès produit';
