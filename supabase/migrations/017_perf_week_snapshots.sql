-- 017_perf_week_snapshots.sql
-- Snapshots hebdomadaires Weekly Perf (navigation historique + comparaisons).

create table if not exists public.perf_week_snapshots (
  week_start date not null,
  sf_user_id text not null,
  iso_week text not null,
  quarter text not null,
  calls integer not null default 0,
  meetings integer not null default 0,
  generated_count integer not null default 0,
  generated_amount numeric not null default 0,
  won_count integer not null default 0,
  won_amount numeric not null default 0,
  won_catalogue numeric not null default 0,
  won_sur_mesure numeric not null default 0,
  won_conseil numeric not null default 0,
  won_arr_amount numeric not null default 0,
  signed_to_date numeric not null default 0,
  forecast numeric not null default 0,
  created_at timestamptz not null default now(),
  primary key (week_start, sf_user_id)
);

create index if not exists perf_week_snapshots_quarter_idx
  on public.perf_week_snapshots (quarter, week_start desc);

create index if not exists perf_week_snapshots_iso_week_idx
  on public.perf_week_snapshots (iso_week desc);

alter table public.perf_week_snapshots enable row level security;

create policy "perf_week_snapshots_select" on public.perf_week_snapshots
  for select to authenticated using (true);
