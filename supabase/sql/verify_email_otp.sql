-- Run in Supabase SQL Editor (after email_verifications exists)

create or replace function public.verify_email_otp(
  p_user_id uuid,
  p_email text,
  p_otp text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if auth.uid() is not null and auth.uid() is distinct from p_user_id then
    return false;
  end if;

  select ev.id, ev.otp_code
  into r
  from public.email_verifications ev
  where ev.user_id = p_user_id
    and lower(trim(ev.email)) = lower(trim(p_email))
    and ev.used = false
    and ev.expires_at > now()
  order by ev.created_at desc
  limit 1;

  if not found then
    return false;
  end if;

  if trim(r.otp_code) <> trim(p_otp) then
    return false;
  end if;

  update public.email_verifications
  set used = true
  where id = r.id;

  return true;
end;
$$;

revoke all on function public.verify_email_otp(uuid, text, text) from public;
grant execute on function public.verify_email_otp(uuid, text, text) to authenticated;
