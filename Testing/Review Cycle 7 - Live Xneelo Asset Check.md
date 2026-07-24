# Review Cycle 7 - Live Xneelo Asset Check

Date: 2026-07-24

## Scope

- Checked `https://www.mrcracing.co.za`.
- Verified the page HTML is live.
- Checked the static asset paths referenced by the live HTML.

## Finding

The live page returns `200` for the homepage HTML, but required static assets return `404`.

Examples:

- `/_next/static/chunks/0ey-pj8hy2ovk.css`
- `/_next/static/chunks/27jktro2p5rq9.js`
- `/images/mrc-racing-tips-logo.jpeg`

This means the root `index.html` was uploaded, but the required `_next` and `images` folders are missing from the Xneelo web root or were extracted into the wrong nested folder.

## Fix Package

Created a clean upload folder:

```text
C:\Users\coetz\OneDrive\MRC Website\Deployment\LIVE FIX - Upload These Files To public_html
```

Created a matching ZIP:

```text
C:\Users\coetz\OneDrive\MRC Website\Deployment\LIVE FIX - Upload These Files To public_html.zip
```

## Required Xneelo Structure

These files/folders must exist directly inside `public_html`:

- `public_html/index.html`
- `public_html/_next`
- `public_html/images`
- `public_html/login`
- `public_html/register`
- `public_html/reset-password`

## Post-upload Checks

These URLs should not return `404` after the fix upload:

- `https://www.mrcracing.co.za/_next/static/chunks/0ey-pj8hy2ovk.css`
- `https://www.mrcracing.co.za/images/mrc-racing-tips-logo.jpeg`
