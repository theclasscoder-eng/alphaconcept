@echo off
REM Double-click this to start the signaling server for LAN use.
REM Secrets are read from .env in this folder (gitignored, generated locally).
REM The current LAN IP is auto-detected and printed below, so you always know
REM which URL to enter on the other PC (your IP changes when you switch networks).
cd /d "%~dp0"

for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169\.254\.' } ^| Select-Object -First 1).IPAddress"') do set LANIP=%%i

echo ==========================================================
echo   AlphaConcept - signaling server
echo.
echo   This PC's IP :  %LANIP%
echo   Use this URL on BOTH PCs (Settings - Signaling server URL):
echo.
echo       ws://%LANIP%:8080/ws
echo.
echo   Keep this window open while you use the app.
echo ==========================================================
echo.

call pnpm --filter @rdp/signaling start:local

echo.
echo Server stopped. Press any key to close.
pause >nul
