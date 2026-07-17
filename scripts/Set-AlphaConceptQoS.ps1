<#
.SYNOPSIS
  Gives AlphaConcept's network traffic real-time priority on this Windows PC.

.DESCRIPTION
  WebRTC in the app now tags its media/input packets as high priority (DSCP EF,
  value 46). Windows only actually applies those DSCP tags when a Policy-based
  QoS policy allows the app to. This script creates that policy for
  AlphaConcept.exe so the operating system (and any QoS-aware router that reads
  DSCP) moves the app's packets ahead of bulk traffic when the link is busy.

  Run this on BOTH the host and the controller machines. It is safe to re-run
  (it removes any previous AlphaConcept policy first). Requires an elevated
  (Administrator) PowerShell.

.PARAMETER Remove
  Delete the policy instead of creating it.

.EXAMPLE
  # From an elevated PowerShell:
  .\Set-AlphaConceptQoS.ps1

.EXAMPLE
  .\Set-AlphaConceptQoS.ps1 -Remove
#>
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$PolicyName = 'AlphaConcept-RealTime'
$Dscp       = 46          # Expedited Forwarding — matches the app's networkPriority 'high'
$AppExe     = 'AlphaConcept.exe'

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p  = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run this in an ELEVATED PowerShell (Run as administrator)."
  }
}

Assert-Admin

# Always clear any prior policy so re-running is clean.
Get-NetQosPolicy -Name $PolicyName -ErrorAction SilentlyContinue |
  Remove-NetQosPolicy -Confirm:$false -ErrorAction SilentlyContinue

if ($Remove) {
  Write-Host "Removed QoS policy '$PolicyName'." -ForegroundColor Green
  return
}

# AppPathNameMatchCondition matches by executable name; this covers the app
# wherever it is installed. Older copies may still be "Remote Desktop.exe".
New-NetQosPolicy -Name $PolicyName `
  -AppPathNameMatchCondition $AppExe `
  -DSCPAction $Dscp `
  -NetworkProfile All | Out-Null

# Also cover legacy exe name from before the rename.
$Legacy = 'AlphaConcept-RealTime-Legacy'
Get-NetQosPolicy -Name $Legacy -ErrorAction SilentlyContinue |
  Remove-NetQosPolicy -Confirm:$false -ErrorAction SilentlyContinue
New-NetQosPolicy -Name $Legacy `
  -AppPathNameMatchCondition 'Remote Desktop.exe' `
  -DSCPAction $Dscp `
  -NetworkProfile All | Out-Null

Write-Host ""
Write-Host "QoS policy '$PolicyName' created (DSCP $Dscp for $AppExe)." -ForegroundColor Green
Write-Host "Run this on BOTH machines. For it to help under load, your router" -ForegroundColor Gray
Write-Host "should also prioritise DSCP 46 traffic (or the host PC's IP)." -ForegroundColor Gray
Write-Host ""
Write-Host "To undo:  .\Set-AlphaConceptQoS.ps1 -Remove" -ForegroundColor DarkGray
