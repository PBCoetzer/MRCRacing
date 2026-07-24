# Review Cycle 11 - Email Templates And SMTP Alias Retest

Date: 2026-07-24

## Scope

- Prepared branded Supabase Authentication templates for all six dashboard sections.
- Generated a Supabase Management API payload for the same templates.
- Checked whether the Supabase dashboard could be updated directly from the in-app browser.
- Retested signup email delivery after the `no-reply@mrcracing.co.za` alias was created.

## Template Files

Template source folder:

- `Deployment/Supabase Email Templates`

Dashboard sections covered:

- Confirm sign up
- Invite user
- Magic link or OTP
- Change email address
- Reset password
- Reauthentication

Generated Management API payload:

- `Deployment/Supabase Email Templates/management-api-payload.json`

## Supabase Dashboard Access

The Supabase dashboard URL opened correctly, but it redirected to the Supabase sign-in screen:

- `https://supabase.com/dashboard/sign-in?returnTo=%2Fproject%2Fcjgfvqgiqrphmakruqnk%2Fauth%2Ftemplates`

Because no Supabase dashboard session, Supabase access token, or Supabase CLI login is available on this machine session, the templates could not be applied automatically.

## SMTP Alias Retest

Test address:

- `no-reply@mrcracing.co.za`

Signup endpoint:

- `POST https://cjgfvqgiqrphmakruqnk.supabase.co/auth/v1/signup`

Result:

- Status: `200`
- Confirmation email requested successfully.
- No SMTP sender verification error appeared for the new test.
- Supabase Auth log recorded `user_confirmation_requested` for `no-reply@mrcracing.co.za`.

## Database Verification

Created Auth user:

- `bce94ede-055f-458b-b004-e285c06a75cb`

Related application rows:

- Profile created: yes
- Wallet created: yes
- Starting wallet balance: `0`
- Role created: `client`
- Terms accepted metadata recorded: yes
- 18+ declaration metadata recorded: yes
- Email confirmed: no, pending confirmation link click

## Important Notes

- The previous blocker for `noreply@mrcracing.co.za` is resolved if Supabase now sends from `no-reply@mrcracing.co.za`.
- If Supabase is still configured with the non-hyphen sender `noreply@mrcracing.co.za`, either update it to `no-reply@mrcracing.co.za` or create the matching `noreply@mrcracing.co.za` alias too.
- The test created a real pending Auth user for `no-reply@mrcracing.co.za`. Keep it if you want to click the received confirmation email, or delete it from Supabase Authentication Users after verification.

## References

- Supabase Email Templates docs: `https://supabase.com/docs/guides/auth/auth-email-templates`
- Supabase Custom SMTP docs: `https://supabase.com/docs/guides/auth/auth-smtp`
