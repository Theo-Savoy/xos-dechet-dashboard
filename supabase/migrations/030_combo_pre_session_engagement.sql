-- 030_combo_pre_session_engagement.sql
-- Persist the pre-session RDV commitment and its launch timestamp.
alter table public.call_sessions
  add column if not exists rdv_goal smallint,
  add column if not exists engaged_at timestamptz;

alter table public.call_sessions
  add constraint call_sessions_rdv_goal_range
  check (rdv_goal is null or (rdv_goal between 1 and 8));
