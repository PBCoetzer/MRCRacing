[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$deploymentDirectory = Split-Path -Parent $PSCommandPath
$config = Get-Content -Raw (Join-Path $deploymentDirectory "xneelo-deploy.json") | ConvertFrom-Json
$credentialPath = Join-Path $deploymentDirectory $config.credentialFile
$credentialDirectory = Split-Path -Parent $credentialPath

New-Item -ItemType Directory -Force -Path $credentialDirectory | Out-Null
$credential = Get-Credential -UserName $config.username -Message "Enter the Xneelo SFTP password for $($config.username)@$($config.host)."
if (-not $credential) {
  throw "Credential entry was cancelled."
}
if ($credential.UserName -ne $config.username) {
  throw "The credential username must remain $($config.username)."
}

$credential.Password | ConvertFrom-SecureString | Set-Content -LiteralPath $credentialPath -Encoding utf8NoBOM
Write-Output "Saved a Windows-DPAPI encrypted Xneelo credential for the current Windows user."
