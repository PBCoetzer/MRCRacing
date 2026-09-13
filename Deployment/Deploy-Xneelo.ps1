[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ApprovalReference,

  [switch]$BackupOnly
)

$ErrorActionPreference = "Stop"
$deploymentDirectory = Split-Path -Parent $PSCommandPath
$config = Get-Content -Raw (Join-Path $deploymentDirectory "xneelo-deploy.json") | ConvertFrom-Json
$credentialPath = Join-Path $deploymentDirectory $config.credentialFile
$pythonScript = Join-Path $deploymentDirectory "deploy_xneelo.py"
$frontendDirectory = (Resolve-Path (Join-Path $deploymentDirectory "..\Frontend")).Path
$outputDirectory = Join-Path $frontendDirectory "out"

if (-not $BackupOnly -and -not (Test-Path -LiteralPath (Join-Path $outputDirectory "index.html"))) {
  throw "No static export exists. Run npm run build:static from Frontend first."
}

if (-not $BackupOnly) {
  Push-Location $frontendDirectory
  try {
    & npm run verify:static
    if ($LASTEXITCODE -ne 0) {
      throw "Static export verification failed. Production deployment is blocked."
    }
  }
  finally {
    Pop-Location
  }
}

Write-Host "Production website operation approval: $ApprovalReference"

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
  $startInfo.ArgumentList.Add((Join-Path $deploymentDirectory "xneelo-deploy.json"))
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
    throw "Could not start the Xneelo deployment helper."
  }
  $process.StandardInput.WriteLine($plainPassword)
  $process.StandardInput.Close()
  $process.WaitForExit()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  if ($stdout) { Write-Output $stdout.TrimEnd() }
  if ($process.ExitCode -ne 0) {
    throw ($stderr.Trim() | ForEach-Object { if ($_){$_}else{"Xneelo deployment failed."} })
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
