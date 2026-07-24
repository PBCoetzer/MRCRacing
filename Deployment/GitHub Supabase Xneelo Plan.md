# GitHub, Supabase, and Xneelo Plan

Status: confirmed resources, GitHub pushed, Supabase auth wired, Xneelo package rebuilt

## Confirmed Resources

- GitHub repository: `PBCoetzer/MRCRacing`
- GitHub URL: `https://github.com/PBCoetzer/MRCRacing`
- Supabase project: `MRCRacing`
- Supabase project ref: `cjgfvqgiqrphmakruqnk`
- Supabase API URL: `https://cjgfvqgiqrphmakruqnk.supabase.co`
- Supabase region: `eu-west-1`
- Xneelo hosting: Volume Plan
- Current Xneelo package: `Deployment/mrc-racing-tips-xneelo-static.zip`

## Recommended Architecture

Use GitHub as the source-control home, Supabase as the backend, and Xneelo Volume Plan hosting for the static website used during live testing.

```text
Local workspace
  -> GitHub: PBCoetzer/MRCRacing
  -> Next.js static export: Frontend/out
  -> Xneelo public_html
  -> Browser calls Supabase Auth and Data API
  -> Supabase Edge Functions handle payment webhooks and secure credit changes
```

## Why This Works

The Xneelo Volume Plan lets the account host multiple web hosting packages. The individual web hosting environment is still best treated as static/PHP hosting for this Next.js project, so the current frontend should be exported as static files and uploaded to `public_html`.

Supabase can handle the dynamic parts that the static Xneelo site should not handle directly:

- User registration and login.
- Protected tables with Row Level Security.
- Client wallet balances.
- Tip unlock history.
- Payment webhook processing.
- Admin audit trails.

## GitHub Setup

The local workspace has been pushed to GitHub.

- Branch: `main`
- Remote: `https://github.com/PBCoetzer/MRCRacing.git`
- Initial commit: `457c4c1`

Future pushes can use:

```powershell
cd "C:\Users\coetz\OneDrive\MRC Website"
git add .
git commit -m "<short description>"
git push
```

Do not commit `.env.local`, Supabase service-role keys, payment provider secrets, or generated ZIP packages.

## Supabase Setup

The baseline database schema has been applied to Supabase.

- Migration: `20260724043604_initial_mrc_racing_schema`
- Migration: `20260724044231_auth_user_profile_bootstrap`
- Migration: `20260724044840_add_missing_foreign_key_indexes`
- Public tables: 15
- RLS policies: 41
- Seeded sports: Horse Racing, Soccer, Rugby, Cricket, Tennis, UFC, Boxing, Greyhound Racing
- Auth bootstrap: new users automatically receive a profile, wallet, and `client` role.

Create a local frontend environment file:

```powershell
cd "C:\Users\coetz\OneDrive\MRC Website\Frontend"
New-Item -ItemType File -Path ".env.local"
```

Add these values from the Supabase dashboard:

```env
NEXT_PUBLIC_SUPABASE_URL=https://cjgfvqgiqrphmakruqnk.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key-from-supabase>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Keep server-only secrets out of frontend builds:

```env
SUPABASE_SERVICE_ROLE_KEY=<server-only-never-commit>
```

Local `.env.local` has been created for development and is intentionally ignored by Git.

## Supabase Auth URLs

In the Supabase dashboard, configure allowed URLs for:

- `http://localhost:3000`
- `http://localhost:3000/login`
- `http://localhost:3000/register`
- `https://<your-live-domain>`
- `https://<your-live-domain>/login`
- `https://<your-live-domain>/register`
- `https://<your-live-domain>/reset-password`

Replace `<your-live-domain>` with the real domain connected to the Xneelo hosting package.

The static site uses the browser origin for auth redirect links, so login and password reset can work on both localhost and the Xneelo domain after the live domain is added to Supabase Auth URL settings.

## Xneelo Upload Flow

Build and package the static site:

```powershell
cd "C:\Users\coetz\OneDrive\MRC Website\Frontend"
npm run build:static
Compress-Archive -Path "C:\Users\coetz\OneDrive\MRC Website\Frontend\out\*" -DestinationPath "C:\Users\coetz\OneDrive\MRC Website\Deployment\mrc-racing-tips-xneelo-static.zip" -Force
```

Upload and extract this ZIP into the hosting package web root:

```text
public_html/index.html
public_html/_next
public_html/images
```

## Next Decisions

- Confirm the live domain name.
- Create the first administrator user and assign the `administrator` role.
- Test live registration, login, logout, and password reset on the Xneelo domain.
- Add Supabase Edge Functions for payment webhooks and secure credit updates.
