@echo off
REM Double-clickable wrapper for apply-update.ps1.
REM Patches an existing Remote Desktop install in place (no reinstall).
REM
REM Usage:
REM   - Double-click me from inside the update folder, OR
REM   - Drag the app folder onto this file, OR
REM   - apply-update.cmd "C:\RemoteDesktop"

setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-update.ps1" -AppPath "%~1"
echo.
pause
