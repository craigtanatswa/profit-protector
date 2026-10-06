-- Keep one active session for each client class so a shop computer and phone
-- can be used together, while a second login on the same class supersedes it.

alter table public.owner_active_sessions
  add column if not exists platform text not null default 'mobile'
  check (platform in ('web', 'mobile'));

alter table public.shopkeeper_active_sessions
  add column if not exists platform text not null default 'mobile'
  check (platform in ('web', 'mobile'));

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.owner_active_sessions'::regclass
      and con.contype in ('p', 'u')
      and array_length(con.conkey, 1) = 1
      and (
        select attname
        from pg_attribute
        where attrelid = con.conrelid and attnum = con.conkey[1]
      ) = 'user_id'
  loop
    execute format('alter table public.owner_active_sessions drop constraint %I', constraint_name);
  end loop;

  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.shopkeeper_active_sessions'::regclass
      and con.contype in ('p', 'u')
      and array_length(con.conkey, 1) = 1
      and (
        select attname
        from pg_attribute
        where attrelid = con.conrelid and attnum = con.conkey[1]
      ) = 'shopkeeper_id'
  loop
    execute format('alter table public.shopkeeper_active_sessions drop constraint %I', constraint_name);
  end loop;
end $$;

create unique index if not exists owner_active_sessions_user_platform_key
  on public.owner_active_sessions (user_id, platform);

create unique index if not exists shopkeeper_active_sessions_shopkeeper_platform_key
  on public.shopkeeper_active_sessions (shopkeeper_id, platform);
