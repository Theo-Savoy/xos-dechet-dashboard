-- 002_email_domain_validation.sql
-- Lot 0.2 — Restrict sign-up to xos-learning.fr domain

-- Update handle_new_user to validate email domain before creating the profile.
-- If email does not match the allowed domain, the transaction is rolled back.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.email !~ '@xos-learning\.fr$' then
    raise exception 'Email domain not allowed: %', new.email;
  end if;

  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end;
$$;
