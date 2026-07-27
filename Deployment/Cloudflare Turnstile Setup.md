# Cloudflare Turnstile Setup

MRC Racing registration now requires a Cloudflare Turnstile token before Supabase Auth accepts a sign-up request.

## Production setup

1. In Cloudflare, create a Turnstile widget for:
   - `mrcracing.co.za`
   - `www.mrcracing.co.za`
2. Use the managed widget mode.
3. Copy the **site key** into `Frontend/.env.local`:

   ```text
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_public_site_key
   ```

4. In Supabase, open **Authentication > Bot and Abuse Protection**.
5. Enable CAPTCHA protection, select **Cloudflare Turnstile**, and save the Turnstile **secret key**.
6. Rebuild the static website:

   ```powershell
   Set-Location "C:\Users\coetz\OneDrive\MRC Website\Frontend"
   npm run build
   ```

7. Upload the new contents of `Frontend/out` to Xneelo.

## Security rules

- The Turnstile site key is public and may use the `NEXT_PUBLIC_` prefix.
- Never place the Turnstile secret key in the frontend, GitHub, or Xneelo static files.
- Keep the secret key only in the Supabase CAPTCHA configuration.
- Registration remains disabled when the public site key is missing.

## Local testing

Cloudflare provides official test keys for localhost. Do not use a test key for the production build.
