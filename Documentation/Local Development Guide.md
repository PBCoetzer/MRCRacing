# Local Development Guide

Status: starter guide

## Requirements

- Node.js
- npm
- Git
- Supabase account for hosted backend work

Detected locally on 24 July 2026:

- Node.js `v24.14.1`
- npm `11.11.0`
- Git `2.53.0.windows.1`

## Planned Frontend Setup

The app will be created in:

`C:\Users\coetz\OneDrive\MRC Website\Frontend`

Expected commands after scaffold:

```powershell
cd "C:\Users\coetz\OneDrive\MRC Website\Frontend"
npm install
npm run dev
```

Expected local URL:

```text
http://localhost:3000
```

## Environment Variables

Use the root `.env.example` as the source for safe placeholders. Real secrets must be placed only in local `.env.local` files or hosting provider secret stores.

## Current Validation

The following commands pass:

```powershell
npm run lint
npm run build
```

`npm audit` reports unresolved Next.js transitive dependency advisories. These are documented in `Documentation\Security Assessment.md`.
