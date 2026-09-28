[CmdletBinding()]
param(
    [string]$Path = (Join-Path $PSScriptRoot '..\..\Frontend\out')
)

$ErrorActionPreference = 'Stop'
$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$forbiddenPatterns = @(
    'dev\.mrcracing\.co\.za',
    'api-dev\.mrcracing\.co\.za',
    'api\.dev\.mrcracing\.co\.za',
    '\.ts\.net',
    'NEXT_PUBLIC_DEV_ADMIN_MFA_BYPASS',
    'MRC_DEV_ADMIN_MFA_BYPASS',
    '@dev\.mrcracing\.test',
    'self-hosted development'
)
$textExtensions = @('.css', '.html', '.js', '.json', '.txt', '.xml')
$violations = New-Object System.Collections.Generic.List[string]

Get-ChildItem -LiteralPath $resolvedPath -Recurse -File | ForEach-Object {
    if ($textExtensions -notcontains $_.Extension.ToLowerInvariant()) {
        return
    }

    $content = Get-Content -Raw -LiteralPath $_.FullName
    foreach ($pattern in $forbiddenPatterns) {
        if ($content -match $pattern) {
            $violations.Add("$($_.FullName): $pattern")
        }
    }
}

if ($violations.Count -gt 0) {
    throw "Production artifact contains development-only references:`n$($violations -join "`n")"
}

$productionHost = 'cjgfvqgiqrphmakruqnk.supabase.co'
$bundleText = Get-ChildItem -LiteralPath $resolvedPath -Recurse -File |
    Where-Object { $textExtensions -contains $_.Extension.ToLowerInvariant() } |
    ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }

if (($bundleText -join "`n") -notmatch [regex]::Escape($productionHost)) {
    throw "Production Supabase host $productionHost was not found in the static export."
}

Write-Host "Production artifact passed environment isolation checks: $resolvedPath"
