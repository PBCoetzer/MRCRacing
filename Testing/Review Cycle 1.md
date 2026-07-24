# Review Cycle 1

Date: 24 July 2026

## Scope

- Workspace setup.
- Documentation baseline.
- Next.js frontend scaffold.
- shadcn/ui initialization.
- Supabase schema baseline.
- First public and dashboard route implementation.

## Tests Performed

- `npm run lint`
- `npm run build`
- `npm audit --json`
- Local HTTP route checks

## Results

- Lint passed.
- Production build passed.
- Next.js generated 14 static routes plus `_not-found`.
- shadcn CLI package was removed from runtime dependencies after audit review.
- Local dev server started at `http://localhost:3000`.
- `/`, `/login`, `/register`, `/admin`, `/client`, and `/tipster` returned HTTP `200`.

## Issues Found And Resolved

- `create-next-app` rejected the uppercase `Frontend` folder name as an npm package name. Resolution: scaffolded in lowercase temporary folder and copied source into the required `Frontend` folder.
- Radix/shadcn components using `Slot` needed explicit client boundaries. Resolution: added client boundaries for providers, header, button, and badge.
- Removing the shadcn CLI package broke `@import "shadcn/tailwind.css"`. Resolution: removed that package import and kept the copied source components.

## Known Issues

- `npm audit` still reports three high-severity findings through `next@16.2.11` transitive dependencies.
- npm's proposed fix is a major downgrade to Next 9, so it has not been applied.
- Supabase authentication and payment flows are not wired yet.
- The temporary `frontend-app` scaffold folder still exists because recursive cleanup was blocked by the local safety policy.

## Final Status

The local frontend foundation builds successfully and is ready for live Supabase wiring, payment adapter work, and deeper UI flows.
