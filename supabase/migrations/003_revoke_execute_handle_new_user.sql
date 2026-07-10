-- 003_revoke_execute_handle_new_user.sql
-- handle_new_user est une fonction trigger : personne ne doit pouvoir l'appeler via RPC.
-- (Advisor Supabase: anon/authenticated_security_definer_function_executable)
revoke execute on function public.handle_new_user() from anon, authenticated, public;
