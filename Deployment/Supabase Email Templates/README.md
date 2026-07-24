# MRCRacing Supabase Auth Email Templates

Date: 2026-07-24

These files are the source of truth for the six Supabase Authentication email templates shown in the dashboard:

- Confirm sign up
- Invite user
- Magic link or OTP
- Change email address
- Reset password
- Reauthentication

## Required SMTP Sender Check

The latest failed SMTP test used this sender:

- `noreply@mrcracing.co.za`

The new alias created for the domain is:

- `no-reply@mrcracing.co.za`

Before retesting, update Supabase Authentication SMTP settings so the sender/admin email is exactly `no-reply@mrcracing.co.za`, or create a matching routeable alias for `noreply@mrcracing.co.za` as well.

Supabase path:

1. Open Supabase Dashboard.
2. Select project `MRCRacing` / `cjgfvqgiqrphmakruqnk`.
3. Go to `Authentication` > `Settings` > `SMTP Settings`.
4. Set the sender/admin email to `no-reply@mrcracing.co.za`.
5. Keep sender name as `MRC Racing Tips`.

## Dashboard Copy/Paste Map

Go to `Authentication` > `Email Templates`, then paste each subject and HTML body:

| Dashboard section | Subject file | HTML body file |
| --- | --- | --- |
| Confirm sign up | `subjects/confirm-signup.subject.txt` | `html/confirm-signup.html` |
| Invite user | `subjects/invite-user.subject.txt` | `html/invite-user.html` |
| Magic link or OTP | `subjects/magic-link-or-otp.subject.txt` | `html/magic-link-or-otp.html` |
| Change email address | `subjects/change-email-address.subject.txt` | `html/change-email-address.html` |
| Reset password | `subjects/reset-password.subject.txt` | `html/reset-password.html` |
| Reauthentication | `subjects/reauthentication.subject.txt` | `html/reauthentication.html` |

## Management API Payload

Supabase also supports updating templates through the Management API. Generate the payload from the template files:

```powershell
.\Deployment\Supabase Email Templates\build-management-api-payload.ps1
```

Then PATCH the generated JSON with a Supabase access token:

```powershell
$env:SUPABASE_ACCESS_TOKEN="paste-token-here"
$projectRef = "cjgfvqgiqrphmakruqnk"
$payload = Get-Content ".\Deployment\Supabase Email Templates\management-api-payload.json" -Raw
Invoke-RestMethod `
  -Method Patch `
  -Uri "https://api.supabase.com/v1/projects/$projectRef/config/auth" `
  -Headers @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN" } `
  -ContentType "application/json" `
  -Body $payload
```

Do not commit or share the Supabase access token.

## Template Notes

- The templates use Supabase GoTrue variables from the official Email Templates documentation.
- `{{ .ConfirmationURL }}` is used for hosted confirmation, invite, recovery, email change, and magic-link flows.
- `{{ .Token }}` is used for OTP and reauthentication code flows.
- The copy is intentionally concise because Supabase recommends keeping authentication emails focused and non-promotional, especially for gambling-related products.
