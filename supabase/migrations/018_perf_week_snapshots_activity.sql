-- 018_perf_week_snapshots_activity.sql
-- Enrichit les snapshots hebdo pour rejouer Line / effort hors Salesforce.

alter table public.perf_week_snapshots
  add column if not exists proposals integer not null default 0,
  add column if not exists progressions integer not null default 0,
  add column if not exists call_results jsonb not null default '{}'::jsonb;
