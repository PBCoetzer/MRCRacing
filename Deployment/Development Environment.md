# MRC development environment

## Architecture

| Component | Development location | Production isolation |
| --- | --- | --- |
| Frontend | `https://dev.mrcracing.co.za` on Xneelo | Separate subdomain folder and deployment config |
| Supabase API/Auth/Studio | `https://api-dev.mrcracing.co.za` on the Linux server | New JWT, API, database, dashboard, and encryption secrets |
| Database | Self-hosted Postgres 17 in Docker | Sanitized copy; production is read only during export |
| Edge Functions | Same source as this branch | Payments and outbound providers disabled |
| Source branch | `codex/self-hosted-development` | Production branch and live files are not touched |

The setup uses the official Supabase self-hosted Docker release `self-hosted/v0.8.2`. A minimum of 4 GB RAM, 2 CPUs, and 40 GB free disk is enforced. Because the server also runs MRC race/build workers, 8 GB RAM, 4 CPUs, and 80 GB free disk are recommended.

## One-time prerequisites

1. Reconnect the server and this workstation to Tailscale.
2. In Xneelo, create the `dev.mrcracing.co.za` subdomain and confirm its document root. The committed default is `public_html/dev.mrcracing.co.za`; use an ignored `Deployment/xneelo-deploy.development.local.json` if Xneelo assigns another path.
3. Add an Xneelo DNS `A` record for `api-dev.mrcracing.co.za` pointing to the Linux server's public IPv4 address.
4. Forward TCP ports `80` and `443` to the Linux server and allow them through its firewall. Do not expose Postgres ports `5432` or `6543` publicly.
5. Confirm the server meets the resource requirements before starting Docker.

## Provision and clone

On the Linux server, check out `codex/self-hosted-development`, then run:

```bash
sudo bash Server/mrc-dev-supabase/bootstrap.sh
sudo bash Server/mrc-dev-supabase/clone-production.sh
sudo bash Server/mrc-dev-supabase/start-development.sh
sudo bash Server/mrc-dev-supabase/configure-test-users.sh
```

Use the production connection string only at the hidden prompt. The script does not write it to disk or Git. The temporary raw dump is deleted whether the restore succeeds or fails.

## Build and deploy the development frontend

Create the ignored environment file:

```powershell
Copy-Item Frontend/.env.development.example Frontend/.env.development.local
```

Paste only the self-hosted `SUPABASE_PUBLISHABLE_KEY` into it. Then deploy:

```powershell
pwsh -File Deployment/Deploy-XneeloDevelopment.ps1 -ChangeReference "DEV-INITIAL-CLONE"
```

The development build:

- refuses the production Supabase project;
- refuses any host except `dev.mrcracing.co.za` and `api-dev.mrcracing.co.za`;
- requires payments to be disabled;
- emits page-level and HTTP `noindex` controls;
- verifies the full static export before SFTP upload;
- cannot upload to the production `public_html` root.

## Acceptance checks

1. `https://api-dev.mrcracing.co.za/auth/v1/health` returns healthy.
2. `https://dev.mrcracing.co.za/robots.txt` disallows `/`.
3. Response headers on the development site contain `X-Robots-Tag: noindex, nofollow, noarchive`.
4. Admin, tipster, and client test accounts can sign in independently.
5. Existing racecards, wallets, purchased/reward Credit balances, entitlements, historical purchases, and tipster earnings appear.
6. Public blog cover images load from development Storage; private application documents do not exist in development.
7. No production email address, phone number, active session, MFA factor, provider payment reference, pending notification, or active cron job remains.
8. Checkout displays as unavailable and no payment provider request can be created.
9. Production `https://www.mrcracing.co.za` and hosted Supabase remain unchanged throughout testing.

## Future Credit split work

Only after this clone passes acceptance should a new migration implement the proposed allocation. Tests must prove that allocation happens when purchased Credits are spent, reward Credits are excluded, the split is 10% Horse Care / 20% platform / 70% tipster, refunds reverse the same entries, retries are idempotent, and historical entries remain unchanged.
