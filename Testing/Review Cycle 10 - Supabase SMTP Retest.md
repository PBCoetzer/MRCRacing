# Review Cycle 10 - Supabase SMTP Retest

Date: 2026-07-24

## Scope

- Retested live account creation after custom SMTP was enabled in Supabase.
- Checked Supabase Auth logs and database records for the new test registration.
- Identified the next production configuration blocker.

## Retest Result

Test address:

- `mrc.codex.smtp.1784873262376@mrcracing.co.za`

Live form result:

- `/register/` loaded correctly.
- All registration fields were present and fillable.
- Form submission reached Supabase Auth.
- The user-facing form showed `Registration issue{}`.
- Browser console errors: `0`.

## Supabase Auth Logs

The previous hosted-email rate limit was cleared:

- Supabase log: `GOTRUE_RATE_LIMIT_EMAIL_SENT changed, updating Email limiter from 2/1h to 30`

The new blocker is SMTP sender verification:

- Endpoint: `/signup`
- Status: `500`
- Error code: `unexpected_failure`
- Auth message: `500: Error sending confirmation email`
- SMTP error: `550 Verification failed for <noreply@mrcracing.co.za>`, `Unrouteable address`, `Sender Verify Failed`

## Database Verification

The test user was not created:

```sql
select id, email, created_at, email_confirmed_at
from auth.users
where email = 'mrc.codex.smtp.1784873262376@mrcracing.co.za';
```

Result:

- `0` rows

## Required Fix

Supabase custom SMTP is active, but the configured sender/from address is not accepted by the SMTP server.

Fix one of the following in Xneelo and Supabase:

- Create a real mailbox or routeable alias for `noreply@mrcracing.co.za`, then keep that as the Supabase SMTP sender.
- Or change the Supabase SMTP sender/admin email to an existing routeable mailbox on `mrcracing.co.za`, ideally the same mailbox used as the SMTP username.

After the change, retest `/register/` once. A successful hosted-confirmation signup should show:

- `Account created. Please check your email to confirm your login.`
- A new `auth.users` row.
- A matching `profiles` row.
- A matching `wallets` row.
- A default `client` role in `user_roles`.

## References

- Supabase custom SMTP docs: `https://supabase.com/docs/guides/auth/auth-smtp`
- Supabase password signup docs: `https://supabase.com/docs/guides/auth/passwords`
