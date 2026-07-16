<#
.SYNOPSIS
  Install the AlphaConcept signaling server as a Windows service.

.DESCRIPTION
  Registers the headless Node signaling server (services/signaling/dist/index.js)
  as a Windows service. Service Name, Display Name, and Description all use
  "AlphaConcept" uniformly.

  Node is not itself a service-aware executable, so this uses NSSM
  (https://nssm.cc) as the service host, which handles start/stop/restart and log
  redirection correctly. Install NSSM first (e.g. `winget install NSSM` or
  `choco install nssm`) so `nssm.exe` is on PATH.

  Run this script from an ELEVATED PowerShell (Administrator). The service is
  visible in services.msc as "AlphaConcept" and is removable with the companion
  Uninstall script — it is not hidden persistence.

.PARAMETER RepoRoot
  Path to the AlphaConcept repo root (contains services/ and .env). Defaults to
  four levels up from this script.

.EXAMPLE
  .\Install-AlphaConceptService.ps1 -RepoRoot "C:\AlphaConcept"
#>
param(
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

# Uniform service identity.
$ServiceName = 'AlphaConcept'
$DisplayName = 'AlphaConcept'
$Description = 'AlphaConcept'

# Elevation check.
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this script from an elevated (Administrator) PowerShell.' }

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
}
$signalingDir = Join-Path $RepoRoot 'services\signaling'
$entry = Join-Path $signalingDir 'dist\index.js'
$envFile = Join-Path $RepoRoot '.env'

if (-not (Test-Path $entry)) {
  throw "Build the signaling server first (pnpm --filter @rdp/signaling build). Missing: $entry"
}

$nssm = (Get-Command nssm.exe -ErrorAction SilentlyContinue)?.Source
$node = (Get-Command node.exe -ErrorAction SilentlyContinue)?.Source
if (-not $node) { throw 'node.exe not found on PATH.' }

if (-not $nssm) {
  Write-Warning 'nssm.exe not found. Install it (winget install NSSM) and re-run.'
  Write-Host 'Alternatively, create the service manually (NOT recommended - node is not service-aware):' -ForegroundColor Gray
  Write-Host "  sc.exe create $ServiceName binPath= `"`"$node`" `"$entry`"`" DisplayName= `"$DisplayName`" start= auto" -ForegroundColor Gray
  return
}

Write-Host "Installing service '$ServiceName' via NSSM..." -ForegroundColor Cyan
& $nssm install $ServiceName $node $entry
& $nssm set $ServiceName AppDirectory $signalingDir
& $nssm set $ServiceName DisplayName $DisplayName
& $nssm set $ServiceName Description $Description
& $nssm set $ServiceName Start SERVICE_AUTO_START
# Load secrets: pass through the machine environment, and point Node at the .env.
if (Test-Path $envFile) {
  & $nssm set $ServiceName AppEnvironmentExtra "DOTENV_CONFIG_PATH=$envFile"
  # dist/index.js reads process.env; use node --env-file for the .env values.
  & $nssm set $ServiceName AppParameters "--env-file=`"$envFile`" `"$entry`""
}
& $nssm set $ServiceName AppStdout (Join-Path $signalingDir 'service.out.log')
& $nssm set $ServiceName AppStderr (Join-Path $signalingDir 'service.err.log')

Write-Host "Starting '$ServiceName'..." -ForegroundColor Cyan
& $nssm start $ServiceName

Write-Host "Done. Service '$ServiceName' installed and started." -ForegroundColor Green
Write-Host "Manage it in services.msc, or: nssm stop/start/restart $ServiceName" -ForegroundColor Gray
