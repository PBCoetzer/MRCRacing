# Database Schema Documentation

Status: baseline design applied to Supabase project `MRCRacing`

Applied migration:

- Project ref: `cjgfvqgiqrphmakruqnk`
- Migration: `20260724043604_initial_mrc_racing_schema`
- Migration: `20260724044231_auth_user_profile_bootstrap`
- Migration: `20260724044840_add_missing_foreign_key_indexes`
- Applied date: 2026-07-24

## Auth Bootstrap

Supabase Auth user creation now triggers `app_private.handle_new_user()`.

The trigger creates:

- A matching `public.profiles` row.
- A matching `public.wallets` row with a zero balance.
- A default `client` role in `public.user_roles`.

The trigger does not trust metadata for authorization. It only stores profile fields and responsible-use timestamps.

## Core Entities

- `profiles`: application profile linked to `auth.users`.
- `user_roles`: role assignments for client, tipster, and administrator access.
- `tipsters`: public tipster profiles and verification status.
- `sports`: supported sports such as horse racing, soccer, rugby, cricket, tennis, UFC, boxing, and greyhound racing.
- `fixtures`: upcoming events, races, matches, or fights.
- `tips`: tipster predictions with analysis, confidence, odds, cost, and publication status.
- `tip_unlocks`: records that a client has unlocked a premium tip.
- `wallets`: current credit balance per user.
- `credit_transactions`: immutable ledger for purchases, unlocks, refunds, and admin adjustments.
- `payments`: payment gateway transactions and webhook reconciliation status.
- `subscriptions`: optional future subscription support.
- `announcements`: public or dashboard announcements.
- `notifications`: user-facing alerts.
- `audit_logs`: sensitive operational activity.
- `media_assets`: Supabase Storage references.

## Roles

- `client`: can purchase credits and unlock premium tips.
- `tipster`: can manage own tipster profile and tips.
- `administrator`: can manage users, content, payments, credits, fixtures, results, and settings.

## RLS Principles

- Enable RLS on every exposed table.
- Users can read and update only their own profile.
- Public users can read published tipster profiles, public fixtures, public results, and visible tip previews.
- Full premium tip analysis is available only to users with a matching `tip_unlocks` row or authorized admin access.
- Tipsters can manage only their own tips.
- Administrators can manage operational tables.
- Audit logs are admin-readable and server-write only.

## Indexing Principles

- Index all foreign keys.
- Index public feed fields: sport, fixture date, tip status, published timestamp, and tipster ranking.
- Index wallet and transaction lookups by user and created date.
- Use unique constraints for idempotency keys and payment provider event IDs.
