create extension if not exists "pgcrypto";

create table tokens (
  id uuid primary key default gen_random_uuid(),
  mint_address text not null unique,
  pair_address text not null,
  symbol text not null,
  name text not null,
  initial_liquidity_usd numeric not null,
  first_seen_at timestamptz not null default now()
);

create table token_snapshots (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references tokens(id) on delete cascade,
  price_usd numeric not null,
  liquidity_usd numeric not null,
  volume_1h_usd numeric not null,
  volume_24h_usd numeric not null,
  buys_1h integer not null,
  sells_1h integer not null,
  market_cap_usd numeric not null,
  captured_at timestamptz not null default now()
);

create index token_snapshots_token_id_idx on token_snapshots(token_id);

create table token_scores (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references token_snapshots(id) on delete cascade,
  total_score numeric not null,
  factors jsonb not null,
  created_at timestamptz not null default now()
);

create index token_scores_snapshot_id_idx on token_scores(snapshot_id);
