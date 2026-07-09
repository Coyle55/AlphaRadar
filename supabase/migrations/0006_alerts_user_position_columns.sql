alter table alerts add column user_id uuid references auth.users(id) on delete cascade;
alter table alerts add column position_id uuid references positions(id) on delete cascade;

create index alerts_position_type_triggered_idx on alerts(position_id, alert_type, triggered_at desc);
