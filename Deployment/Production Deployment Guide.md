# Production Deployment Guide

Status: initial strategy

Confirmed cloud resource map: `Deployment/GitHub Supabase Xneelo Plan.md`

## Hosting

The current live-testing path is:

- GitHub repository: `PBCoetzer/MRCRacing`.
- Supabase project: `MRCRacing`.
- Xneelo Volume Plan hosting for the static frontend export.

The preferred final production path is:

- Vercel for the Next.js application.
- Supabase for PostgreSQL, Auth, and Storage.

Alternative Node.js-compatible hosting can work if it supports:

- Node.js runtime.
- Environment variables.
- HTTPS.
- Background-safe webhook route handling.
- Next.js standalone output or managed Next.js deployment.

Examples to evaluate later:

- Xneelo
- Afrihost
- Domains.co.za
- VPS provider with Node.js support

## Xneelo Web Hosting Static Deployment

Xneelo's standard Web Hosting and Managed Server environments are LAMP based: Linux, Apache, MariaDB/MySQL, and PHP. This means the current web hosting package is suitable for a static export of the Next.js frontend, but not for running a persistent Next.js Node.js server.

Use this path for public UI testing:

1. Build the static site locally.

```powershell
cd "C:\Users\coetz\OneDrive\MRC Website\Frontend"
npm run build:static
```

2. Confirm the exported site exists in:

```text
C:\Users\coetz\OneDrive\MRC Website\Frontend\out
```

3. Upload the contents of `out` to the Xneelo website root, usually `public_html`, using Xneelo File Manager, FTP, or SFTP.

4. Make sure `index.html` is directly inside the web root, not nested inside an extra `out` folder.

5. Test:

- `/`
- `/pricing/`
- `/tipsters/`
- `/tipsters/profile/?tipster=<id>`
- `/payment-status/`
- `/login/`
- `/register/`
- `/client/`
- `/tipster/`
- `/admin/`

## Xneelo Limitations For Later Phases

The static deployment is enough for public UI delivery. The following features run in Supabase Edge Functions rather than Xneelo:

- PayFast checkout signing and ITN verification.
- Ozow checkout signing, notification hash verification, and transaction confirmation.
- Atomic Credit issuance after verified provider callbacks.
- Tip publication and correction email processing.
- Sports data sync jobs.

Recommended future backend options:

- Supabase Edge Functions for payment webhooks, credit unlock logic, and scheduled sports data sync.
- Xneelo Cloud or Self-Managed Server if we want to host a full Node.js Next.js server ourselves.
- Vercel if we want the simplest production Next.js deployment path.

## Production Requirements

- Configure all secrets in hosting environment variables.
- Configure Supabase Auth redirect URLs.
- Configure payment gateway webhook URLs.
- Set `PAYMENTS_ENABLED=true` only after provider credentials and callback verification tests pass.
- Enable HTTPS before payment webhooks.
- Run database migrations against the production Supabase project.
- Review RLS policies before launch.
- Run final accessibility, SEO, performance, and security checks.

## Current Xneelo Test Package

Prepared upload package:

```text
C:\Users\coetz\OneDrive\MRC Website\Deployment\mrc-racing-tips-xneelo-static.zip
```

This ZIP contains the contents of the static `out` directory and includes the current Supabase-enabled login, registration, password reset, and admin access screens. In Xneelo, upload/extract the ZIP so the files inside it land directly in the website root. The home page must resolve as:

```text
public_html/index.html
```

If it becomes `public_html/out/index.html`, move the files up one level.

## Xneelo Upload Checklist

1. Log in to the Xneelo Control Panel or konsoleH for the domain.
2. Open File Manager, FTP, or SFTP for the hosting package.
3. Go to the website root directory, normally `public_html`.
4. Back up any existing website files if the domain already has content.
5. Upload `mrc-racing-tips-xneelo-static.zip`.
6. Extract it into `public_html`.
7. Confirm `_next`, `images`, and `index.html` are directly inside `public_html`.
8. Visit the live domain and test the main routes.

Before testing auth on the live domain, add the domain and `/reset-password` route to Supabase Auth URL settings.

Payment return URLs must point to the deployed Supabase `payment-return` Edge Function. Browser return URLs never issue Credits; only verified PayFast ITN or Ozow notification processing can finalize a payment.

## Rebuild After Changes

Whenever the website changes locally, rebuild and repackage:

```powershell
cd "C:\Users\coetz\OneDrive\MRC Website\Frontend"
npm run build:static
Compress-Archive -Path "C:\Users\coetz\OneDrive\MRC Website\Frontend\out\*" -DestinationPath "C:\Users\coetz\OneDrive\MRC Website\Deployment\mrc-racing-tips-xneelo-static.zip" -Force
```
