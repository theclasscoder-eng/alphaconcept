@echo off
REM ---------------------------------------------------------------------------
REM Launch AlphaConcept AS ADMINISTRATOR.
REM
REM Copy this file next to AlphaConcept.exe (or Remote Desktop.exe on older
REM copies) and run it. Windows blocks remote input to windows opened
REM "as administrator" unless the app itself is elevated, so this launcher
REM requests elevation (one UAC prompt) and starts the app elevated.
REM
REM It also sets the default signaling server URL for the first run; after that,
REM whatever you set in Settings -> Signaling server URL wins.
REM  >>> If the main PC's IP changes, edit the line below or change it in Settings.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"
set "SIGNALING_PUBLIC_URL=ws://172.20.10.8:8080/ws"

set "EXE=AlphaConcept.exe"
if not exist "%EXE%" set "EXE=Remote Desktop.exe"
if not exist "%EXE%" (
  echo Could not find AlphaConcept.exe next to this launcher.
  pause
  exit /b 1
)

echo Launching "%EXE%" as administrator (approve the UAC prompt)...
powershell -NoProfile -Command "Start-Process -FilePath '%CD%\%EXE%' -Verb RunAs"
