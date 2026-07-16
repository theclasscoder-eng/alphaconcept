<#
.SYNOPSIS
  Remove the AlphaConcept Windows service. Run from an elevated PowerShell.
#>
$ErrorActionPreference = 'Stop'
$ServiceName = 'AlphaConcept'

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this script from an elevated (Administrator) PowerShell.' }

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) { Write-Host "Service '$ServiceName' is not installed."; return }

$nssm = (Get-Command nssm.exe -ErrorAction SilentlyContinue)?.Source
if ($nssm) {
  & $nssm stop $ServiceName
  & $nssm remove $ServiceName confirm
} else {
  Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  sc.exe delete $ServiceName | Out-Null
}
Write-Host "Service '$ServiceName' removed." -ForegroundColor Green
