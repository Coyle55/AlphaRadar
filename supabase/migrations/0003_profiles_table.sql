-- supabase/migrations/0003_profiles_table.sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  telegram_chat_id text,
  subscription_tier text not null default 'free',
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
