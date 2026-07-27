# Review Cycle 14 - Confirmation Email Diagnosis

Date: 2026-07-27

## Finding

Supabase Auth logs showed that the recent registration attempts were classified as `user_repeated_signup`. The tested email address already belonged to a confirmed account, so Supabase did not create another account or request another confirmation email.

The original signup flow had previously produced both:

- `user_confirmation_requested`
- `user_signedup`

There were no SMTP handoff errors associated with the recent attempts.

## Account State

- The account exists.
- A confirmation email was previously requested.
- The email address was successfully confirmed.
- Repeating signup with the same confirmed email does not issue another confirmation email.

## Application Fix

The registration form now detects Supabase's empty-identity repeated-signup response and no longer displays `Account created`.

It instead displays neutral guidance with actions to:

- Log in using the existing account.
- Request a password reset.

The message avoids exposing whether an arbitrary email address definitely exists.

## Retest Requirements

- Use the existing account's login credentials, or request a password reset.
- To test a genuinely new confirmation email, register with an email address that has never been used in the project.
