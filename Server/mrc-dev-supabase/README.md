# MRC self-hosted development Supabase

This directory provisions a development-only Supabase stack on the MRC Linux server. It is pinned to `self-hosted/v0.8.2`, uses `api-dev.mrcracing.co.za`, and deliberately disables payment processing and every copied outbound queue.

## Safety model

- The production database is read only during export.
- The raw dump exists only in a mode-`0700` temporary directory and is deleted on exit.
- Auth sessions, refresh tokens, MFA secrets, one-time tokens, application documents, email logs, notification queues, worker tokens, and private admin logs are not retained.
- Emails, names, phone numbers, passwords, payment references, idempotency keys, payment payloads, and private notes are sanitized.
- Wallets, purchased/reward Credit balances, purchases, entitlements, tipster earnings, race data, and existing allocation values remain relationally intact for realistic testing.
- Payments, email, SMS, Telegram, race workers, and site-build workers remain disabled until separately configured for development.
- All imported cron jobs are inactive.
- Public blog cover images are copied from the public production bucket after the sanitized database is running. Private Storage objects are never copied.

## Server sequence

Run these commands from this repository checkout on the Linux server:

```bash
sudo bash Server/mrc-dev-supabase/bootstrap.sh
sudo bash Server/mrc-dev-supabase/clone-production.sh
sudo bash Server/mrc-dev-supabase/start-development.sh
sudo bash Server/mrc-dev-supabase/configure-test-users.sh
```

`clone-production.sh` prompts for the production database connection URL without storing it. `configure-test-users.sh` prompts for three development passwords without storing them.

The controlled logins are:

- `admin@dev.mrcracing.test`
- `tipster@dev.mrcracing.test`
- `client@dev.mrcracing.test`

To intentionally replace a previous development clone, back it up and run:

```bash
sudo ALLOW_REPLACE_DEVELOPMENT_DATABASE=YES bash Server/mrc-dev-supabase/clone-production.sh
```

That command deletes only the self-hosted development Docker volumes before restoring the new sanitized clone. It never changes the hosted production project.

## Frontend configuration

Copy `Frontend/.env.development.example` to the ignored `Frontend/.env.development.local`, then paste the generated `SUPABASE_PUBLISHABLE_KEY` from `/opt/mrc-dev-supabase/.env`.

```powershell
cd Frontend
Copy-Item .env.development.example .env.development.local
npm run build:development
```

The build fails if it sees the production Supabase project, a non-development hostname, enabled payments, or a placeholder key.

## Re-enabling integrations

Do not copy production provider secrets into `.env.functions`. Add dedicated sandbox credentials one integration at a time. Keep `PAYMENTS_ENABLED=false` until the financial test plan explicitly requires sandbox checkout testing.
