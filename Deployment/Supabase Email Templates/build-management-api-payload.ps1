$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$templates = [ordered]@{
  "mailer_subjects_confirmation" = (Get-Content -LiteralPath (Join-Path $root "subjects\confirm-signup.subject.txt") -Raw).Trim()
  "mailer_templates_confirmation_content" = Get-Content -LiteralPath (Join-Path $root "html\confirm-signup.html") -Raw
  "mailer_subjects_invite" = (Get-Content -LiteralPath (Join-Path $root "subjects\invite-user.subject.txt") -Raw).Trim()
  "mailer_templates_invite_content" = Get-Content -LiteralPath (Join-Path $root "html\invite-user.html") -Raw
  "mailer_subjects_magic_link" = (Get-Content -LiteralPath (Join-Path $root "subjects\magic-link-or-otp.subject.txt") -Raw).Trim()
  "mailer_templates_magic_link_content" = Get-Content -LiteralPath (Join-Path $root "html\magic-link-or-otp.html") -Raw
  "mailer_subjects_email_change" = (Get-Content -LiteralPath (Join-Path $root "subjects\change-email-address.subject.txt") -Raw).Trim()
  "mailer_templates_email_change_content" = Get-Content -LiteralPath (Join-Path $root "html\change-email-address.html") -Raw
  "mailer_subjects_recovery" = (Get-Content -LiteralPath (Join-Path $root "subjects\reset-password.subject.txt") -Raw).Trim()
  "mailer_templates_recovery_content" = Get-Content -LiteralPath (Join-Path $root "html\reset-password.html") -Raw
  "mailer_subjects_reauthentication" = (Get-Content -LiteralPath (Join-Path $root "subjects\reauthentication.subject.txt") -Raw).Trim()
  "mailer_templates_reauthentication_content" = Get-Content -LiteralPath (Join-Path $root "html\reauthentication.html") -Raw
}

$payloadPath = Join-Path $root "management-api-payload.json"
$templates | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $payloadPath -Encoding UTF8

Write-Host "Wrote $payloadPath"
