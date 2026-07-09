create table positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_id uuid not null references tokens(id) on delete cascade,
  entry_price numeric not null,
  entry_market_cap numeric not null,
  amount numeric,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create index positions_open_idx on positions(closed_at) where closed_at is null;
create index positions_user_id_idx on positions(user_id);
