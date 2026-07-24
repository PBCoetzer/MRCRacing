# Review Cycle 4 - Xneelo Static Export

Date: 2026-07-24

## Scope

- Prepared the Next.js frontend for Xneelo shared web hosting as a static export.
- Confirmed the export output includes `index.html`, `_next`, and `images`.
- Created an upload-ready ZIP package for live testing.

## Validation

- `npm run lint` passed.
- `npm run build:static` passed.
- Static output folder exists at `C:\Users\coetz\OneDrive\MRC Website\Frontend\out`.
- Upload package exists at `C:\Users\coetz\OneDrive\MRC Website\Deployment\mrc-racing-tips-xneelo-static.zip`.

## Deployment Notes

- Upload the contents of the ZIP directly into the Xneelo web root, normally `public_html`.
- Confirm `public_html/index.html` exists after extraction.
- If the files extract into `public_html/out`, move the contents of `out` up one directory.

## Limitations

- This deployment is for visual and public route testing.
- Payment webhooks, secure credit unlocks, Supabase server callbacks, and scheduled data sync still need a backend runtime.
