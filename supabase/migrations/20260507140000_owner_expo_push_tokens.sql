-- Expo push tokens for business owners (multiple devices per user supported).

create table if not exists public.owner_expo_push_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, expo_push_token)
);

create index if not exists owner_expo_push_tokens_user_id_idx
  on public.owner_expo_push_tokens (user_id);

comment on table public.owner_expo_push_tokens is
  'Expo push tokens for low-stock and other owner alerts when the app is not running.';

alter table public.owner_expo_push_tokens enable row level security;

drop policy if exists "owner_expo_push_tokens_select_own" on public.owner_expo_push_tokens;
drop policy if exists "owner_expo_push_tokens_insert_own" on public.owner_expo_push_tokens;
drop policy if exists "owner_expo_push_tokens_update_own" on public.owner_expo_push_tokens;
drop policy if exists "owner_expo_push_tokens_delete_own" on public.owner_expo_push_tokens;

create policy "owner_expo_push_tokens_select_own"
  on public.owner_expo_push_tokens for select
  using (auth.uid() = user_id);

create policy "owner_expo_push_tokens_insert_own"
  on public.owner_expo_push_tokens for insert
  with check (auth.uid() = user_id);

create policy "owner_expo_push_tokens_update_own"
  on public.owner_expo_push_tokens for update
  using (auth.uid() = user_id);

create policy "owner_expo_push_tokens_delete_own"
  on public.owner_expo_push_tokens for delete
  using (auth.uid() = user_id);
