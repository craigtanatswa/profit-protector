-- Short-lived tokens after recovery OTP verify (used by Edge Functions)

create table if not exists public.recovery_password_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

create index if not exists recovery_password_sessions_token_idx
  on public.recovery_password_sessions (token)
  where expires_at > now();

-- Edge Functions use the service role only; app clients never read this table.
alter table public.recovery_password_sessions disable row level security;
