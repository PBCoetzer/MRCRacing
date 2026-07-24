# MRC Racing Tips Frontend

This is the local Next.js frontend for MRC Racing Tips.

## Commands

```powershell
npm install
npm run dev
npm run lint
npm run build
```

## Local URL

```text
http://localhost:3000
```

## Implemented Routes

- `/`
- `/about`
- `/pricing`
- `/faq`
- `/contact`
- `/responsible-gambling`
- `/privacy`
- `/terms`
- `/login`
- `/register`
- `/forgot-password`
- `/client`
- `/tipster`
- `/admin`

## Notes

- Supabase client utilities exist in `src/lib/supabase`.
- Forms are UI-ready but not connected to Supabase actions yet.
- Mock data lives in `src/lib/mock-data.ts` until live database wiring starts.
