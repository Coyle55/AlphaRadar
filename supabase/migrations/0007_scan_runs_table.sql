create table scan_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('cron', 'manual')),
  started_at timestamptz not null default now()
);

create index scan_runs_started_at_idx on scan_runs(started_at desc);
