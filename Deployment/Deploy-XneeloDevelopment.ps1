[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ChangeReference,

  [switch]$BackupOnly
)

$ErrorActionPreference = "Stop"
$deploymentDirectory = Split-Path -Parent $PSCommandPath
$configPath = Join-Path $deploymentDirectory "xneelo-deploy.development.local.json"
if (-not (Test-Path -LiteralPath $configPath)) {
  $configPath = Join-Path $deploymentDirectory "xneelo-deploy.development.json"
}
$config = Get-Content -Raw $configPath | ConvertFrom-Json
$credentialPath = Join-Path $deploymentDirectory $config.credentialFile
$pythonScript = Join-Path $deploymentDirectory "deploy_xneelo.py"
$frontendDirectory = (Resolve-Path (Join-Path $deploymentDirectory "..\Frontend")).Path

if ($config.remoteRoot -eq "public_html" -or $config.remoteRoot -notmatch "dev\.mrcracing\.co\.za") {
  throw "Development deployment refused: remoteRoot is not the development subdomain directory."
}

if (-not $BackupOnly) {
  Push-Location $frontendDirectory
  try {
    & npm run build:development
    if ($LASTEXITCODE -ne 0) {
      throw "Development build failed. Deployment is blocked."
    }
    & npm run verify:development
    if ($LASTEXITCODE -ne 0) {
      throw "Development export verification failed. Deployment is blocked."
    }
  }
  finally {
    Pop-Location
  }
}

Write-Host "Development website operation: $ChangeReference"
Write-Host "Remote root: $($config.remoteRoot)"

if (-not (Test-Path -LiteralPath $credentialPath)) {
  throw "No encrypted Xneelo credential exists. Run Deployment/Save-XneeloCredential.ps1 first."
}
if (-not (Test-Path -LiteralPath $pythonScript)) {
  throw "The Xneelo deployment helper is missing."
}

$encryptedPassword = (Get-Content -Raw -LiteralPath $credentialPath).Trim()
$securePassword = ConvertTo-SecureString $encryptedPassword
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = $null

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $python = (Get-Command python -ErrorAction Stop).Source
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $python
  $startInfo.ArgumentList.Add($pythonScript)
  $startInfo.ArgumentList.Add("--config")
  $startInfo.ArgumentList.Add($configPath)
  if ($BackupOnly) {
    $startInfo.ArgumentList.Add("--backup-only")
  }
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true

  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "Could not start the Xneelo development deployment helper."
  }
  $process.StandardInput.WriteLine($plainPassword)
  $process.StandardInput.Close()
  $process.WaitForExit()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  if ($stdout) { Write-Output $stdout.TrimEnd() }
  if ($process.ExitCode -ne 0) {
    throw ($stderr.Trim() | ForEach-Object { if ($_){$_}else{"Xneelo development deployment failed."} })
  }
  if ($stderr) { Write-Warning $stderr.Trim() }
}
finally {
  $encryptedPassword = $null
  $plainPassword = $null
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
}
