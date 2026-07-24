# GitHub, Supabase, and Xneelo Plan

Status: confirmed resources, pending production wiring

## Confirmed Resources

- GitHub repository: `PBCoetzer/MRCRacing`
- GitHub URL: `https://github.com/PBCoetzer/MRCRacing`
- Supabase project: `MRCRacing`
- Supabase project ref: `cjgfvqgiqrphmakruqnk`
- Supabase API URL: `https://cjgfvqgiqrphmakruqnk.supabase.co`
- Supabase region: `eu-west-1`
- Xneelo hosting: Volume Plan

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

The local workspace is not yet a Git repository. When ready to push, use:

```powershell
cd "C:\Users\coetz\OneDrive\MRC Website"
git init
git branch -M main
git remote add origin https://github.com/PBCoetzer/MRCRacing.git
git add .
git commit -m "Initial MRC Racing website workspace"
git push -u origin main
```

Do not commit `.env.local`, Supabase service-role keys, payment provider secrets, or generated ZIP packages.

## Supabase Setup

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

## Supabase Auth URLs

In the Supabase dashboard, configure allowed URLs for:

- `http://localhost:3000`
- `http://localhost:3000/login`
- `http://localhost:3000/register`
- `https://<your-live-domain>`
- `https://<your-live-domain>/login`
- `https://<your-live-domain>/register`

Replace `<your-live-domain>` with the real domain connected to the Xneelo hosting package.

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
- Decide whether I should initialise the local Git repository and push to `PBCoetzer/MRCRacing`.
- Decide whether I should apply the baseline schema to Supabase now or first convert it into reviewed migrations.
