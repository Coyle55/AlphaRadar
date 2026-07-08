create table alerts (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references tokens(id) on delete cascade,
  alert_type text not null,
  triggered_at timestamptz not null default now(),
  payload jsonb not null,
  telegram_sent boolean not null default false,
  telegram_error text
);

create index alerts_token_type_triggered_idx on alerts(token_id, alert_type, triggered_at desc);
