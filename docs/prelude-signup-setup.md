# Prelude OTP signup (Profit Protector)

## Overview

Phone signup uses **Prelude** Verify API from Supabase Edge Functions:

1. **`send-otp`** — `POST /v2/verification` at `https://api.prelude.dev` (rate-limited per phone).
2. **`verify-otp`** — `POST /v2/verification/check`; on success creates **`auth.users`** (phone + synthetic email + password) and a row in **`public.app_users`** with **`phone_verified = true`**.

Login stays **phone/username + password** via Supabase Auth. After sign-in, the app checks **`app_users.phone_verified`** (legacy accounts without a row are allowed until you run the backfill SQL).

## Supabase secrets

Set for **Edge Functions** (Dashboard → Edge Functions → Secrets, or CLI):

| Secret | Description |
|--------|-------------|
| `PRELUDE_API_KEY` | Prelude API key (`sk_…`). Never put this in the Expo app. |
| `OTP_EXPIRY_MINUTES` | Optional; reserved for future use (Prelude manages OTP lifetime). |
| `PRELUDE_API_BASE` | Optional override; default `https://api.prelude.dev`. |

Remove obsolete SMS-provider secrets (`EASYSENDSMS_*`) if you no longer use them.

## Database

Run in order (SQL Editor):

1. **`supabase/sql/app_users.sql`** — `app_users`, `prelude_otp_send_rate`, backfill from `businesses`.
2. Existing **`businesses`** / RLS unchanged.

Optional cleanup (only if you relied on the old nonce flow):

- `signup_phone_verifications` / `consume_signup_phone_verification` can remain unused.

## Deploy functions

```bash
supabase functions deploy send-otp
supabase functions deploy verify-otp
```

## App flows

- **Register (`app/(auth)/register.tsx`)** — Phone + password → Prelude OTP → verify (**creates account**) → business steps → **`createBusinessProfile`** (session required).
- **Onboarding convert** — Same Prelude gate, then **`createBusinessProfile`**.
- **Login** — Blocks sign-in when **`app_users.phone_verified`** is explicitly false.
- **Standalone phone verify screen** — Requires an existing session; calls Prelude check without password.

## Security notes

- Passwords are hashed by **Supabase Auth** only; **`app_users.password_hash`** is unused (`NULL`).
- Do **not** commit Prelude keys or paste them into tickets.
