@echo off
REM Double-click to give AlphaConcept real-time network priority on this PC.
REM Self-elevates (one UAC prompt), then runs Set-AlphaConceptQoS.ps1.
REM Run this once on BOTH the host and the controller machine.

net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Set-AlphaConceptQoS.ps1"
echo.
pause
