<#
.SYNOPSIS
  Patches an installed/copied AlphaConcept app in place - no reinstall.

.DESCRIPTION
  Because the app is packaged with asar disabled, its code lives as plain files
  under <app>\resources\app\out. This script swaps in a new build of that folder
  (~600 KB) instead of shipping the whole 287 MB app again.

  It backs up the previous build to out.bak first, so you can roll back.

.PARAMETER AppPath
  Folder containing AlphaConcept.exe (or the older Remote Desktop.exe). If
  omitted, the script looks next to itself, then in the usual install locations.

.EXAMPLE
  .\apply-update.ps1
  .\apply-update.ps1 -AppPath "C:\AlphaConcept"
#>
param([string]$AppPath)

$ErrorActionPreference = 'Stop'
# The app was renamed AlphaConcept; older copies are still "Remote Desktop.exe".
$EXE_NAMES = @('AlphaConcept.exe', 'Remote Desktop.exe')

function Write-Step($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "=== AlphaConcept - in-place update ===" -ForegroundColor White
Write-Host ""

# The new build shipped alongside this script.
$newOut = Join-Path $PSScriptRoot 'out'
if (-not (Test-Path (Join-Path $newOut 'main\index.js'))) {
  throw "No 'out' folder next to this script. Run this from the update package folder."
}

function Test-AppRoot([string]$path) {
  if ([string]::IsNullOrWhiteSpace($path)) { return $false }
  foreach ($exe in $EXE_NAMES) { if (Test-Path (Join-Path $path $exe)) { return $true } }
  return $false
}

# --- locate the app -------------------------------------------------------
$candidates = @()
if ($AppPath)      { $candidates += $AppPath }
$candidates += $PSScriptRoot
$candidates += (Split-Path $PSScriptRoot -Parent)
$candidates += (Join-Path $env:LOCALAPPDATA 'Programs\alphaconcept')
$candidates += (Join-Path $env:LOCALAPPDATA 'Programs\AlphaConcept')
$candidates += (Join-Path ${env:ProgramFiles} 'AlphaConcept')
$candidates += (Join-Path $env:LOCALAPPDATA 'Programs\remote-desktop')
$candidates += (Join-Path ${env:ProgramFiles} 'Remote Desktop')

$root = $candidates | Where-Object { Test-AppRoot $_ } | Select-Object -First 1

# Last resort: search the usual roots for either exe name.
if (-not $root) {
  Write-Step "Searching for the app..."
  foreach ($base in @((Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles, "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Downloads", 'C:\')) {
    if (-not (Test-Path $base)) { continue }
    foreach ($exe in $EXE_NAMES) {
      $hit = Get-ChildItem -Path $base -Filter $exe -Recurse -Depth 4 -ErrorAction SilentlyContinue |
             Select-Object -First 1
      if ($hit) { $root = $hit.DirectoryName; break }
    }
    if ($root) { break }
  }
}

if (-not $root) {
  Write-Host ""
  Write-Warn "Could not find the app automatically."
  Write-Host "  Re-run with the app folder, e.g.:" -ForegroundColor Gray
  Write-Host '      .\apply-update.ps1 -AppPath "C:\RemoteDesktop"' -ForegroundColor Gray
  throw "App not found."
}

Write-Ok "Found app: $root"

$target = Join-Path $root 'resources\app\out'
if (-not (Test-Path (Split-Path $target -Parent))) {
  throw "Unexpected layout: $target's parent does not exist. Is this really the app folder?"
}

# --- show versions --------------------------------------------------------
$pkg = Join-Path $root 'resources\app\package.json'
if (Test-Path $pkg) {
  $old = (Get-Content $pkg -Raw | ConvertFrom-Json).version
  Write-Step "Installed version: $old"
}
$newPkg = Join-Path $PSScriptRoot 'package.json'
if (Test-Path $newPkg) {
  $new = (Get-Content $newPkg -Raw | ConvertFrom-Json).version
  Write-Step "Update version:    $new"
}

# --- stop the running app -------------------------------------------------
$proc = Get-Process -Name 'AlphaConcept', 'Remote Desktop' -ErrorAction SilentlyContinue
if ($proc) {
  Write-Step "Closing the running app..."
  $proc | Stop-Process -Force
  Start-Sleep -Seconds 2
  Write-Ok "Closed."
}

# --- back up + swap -------------------------------------------------------
$backup = Join-Path $root 'resources\app\out.bak'
if (Test-Path $target) {
  if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
  Write-Step "Backing up current build -> out.bak"
  Move-Item $target $backup
}

Write-Step "Installing new build..."
Copy-Item $newOut $target -Recurse -Force

# Keep package.json version in sync so the app reports the new version.
if ((Test-Path $newPkg) -and (Test-Path $pkg)) {
  Copy-Item $newPkg $pkg -Force
}

Write-Host ""
Write-Ok "Update complete."
Write-Host "  Start the app again (Start AlphaConcept (Admin).cmd or $EXE)." -ForegroundColor Gray
Write-Host "  To roll back: delete 'resources\app\out' and rename 'out.bak' back to 'out'." -ForegroundColor DarkGray
Write-Host ""
