# Review Cycle 8 - FTP Live Upload Fix

Date: 2026-07-24

## Scope

- Tested SFTP access for `mrcracing.co.za`.
- Uploaded the corrected static export folder structure to Xneelo `public_html`.
- Verified live static assets and browser rendering.

## Finding

The previous upload flattened files into `public_html`, so the homepage HTML loaded but required assets returned `404`.

Broken before fix:

- `/_next/static/chunks/0ey-pj8hy2ovk.css`
- `/_next/static/chunks/27jktro2p5rq9.js`
- `/images/mrc-racing-tips-logo.jpeg`

## Upload Result

Uploaded `180` static export files via SFTP.

Verified on the server:

- `public_html/index.html`
- `public_html/_next/static/chunks/0ey-pj8hy2ovk.css`
- `public_html/_next/static/chunks/27jktro2p5rq9.js`
- `public_html/images/mrc-racing-tips-logo.jpeg`
- `public_html/reset-password/index.html`

## Live URL Checks

The following URLs returned `200` after upload:

- `https://www.mrcracing.co.za/`
- `https://www.mrcracing.co.za/_next/static/chunks/0ey-pj8hy2ovk.css`
- `https://www.mrcracing.co.za/_next/static/chunks/27jktro2p5rq9.js`
- `https://www.mrcracing.co.za/images/mrc-racing-tips-logo.jpeg`
- `https://www.mrcracing.co.za/reset-password/`

## Browser Render Check

- Page title: `MRC Racing Tips | Premium Sports Tips`
- Primary heading: `MRC Racing Tips`
- Logo natural width: `1128`
- Body background: themed purple
- Heading font: `Bungee`

## Notes

- SFTP worked on port `22`.
- Plain FTP on port `21` returned access denied.
- Credentials were not saved in project documentation.
