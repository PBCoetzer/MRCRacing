$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$output = Join-Path $PSScriptRoot "..\public\images\mrc-racing-og.png"
$bitmap = New-Object System.Drawing.Bitmap 1200, 630
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(30, 12, 56))
$purple = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(74, 24, 112))
$gold = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 176, 0))
$cyan = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 212, 231))
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$graphics.FillRectangle($purple, 0, 0, 1200, 18)
$graphics.FillRectangle($cyan, 0, 612, 1200, 18)
$heading = New-Object System.Drawing.Font "Arial", 68, ([System.Drawing.FontStyle]::Bold)
$subheading = New-Object System.Drawing.Font "Arial", 32, ([System.Drawing.FontStyle]::Regular)
$label = New-Object System.Drawing.Font "Arial", 22, ([System.Drawing.FontStyle]::Bold)
$graphics.DrawString("MRC RACING TIPS", $heading, $white, 70, 160)
$graphics.DrawString("South African Horse Racing", $subheading, $gold, 74, 275)
$graphics.DrawString("Verified tipsters  •  Factual racecards  •  Results history", $label, $cyan, 76, 365)
$graphics.DrawString("18+  •  Gamble responsibly", $label, $white, 76, 455)
$bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
$heading.Dispose(); $subheading.Dispose(); $label.Dispose()
$purple.Dispose(); $gold.Dispose(); $cyan.Dispose(); $white.Dispose()
$graphics.Dispose(); $bitmap.Dispose()
Write-Output $output
