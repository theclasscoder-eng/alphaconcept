@echo off
REM Builds the app bundles and assembles a small in-place update package
REM (~600 KB) that can be copied to another PC and applied without reinstalling.
REM
REM Output: apps\desktop\release\update\  and  apps\desktop\release\update.zip

setlocal
cd /d "%~dp0.."

echo === Building desktop bundles ===
call pnpm --filter @rdp/desktop build || goto :fail

set UPD=apps\desktop\release\update
if exist "%UPD%" rmdir /s /q "%UPD%"
mkdir "%UPD%" 2>nul

echo === Assembling update package ===
xcopy /e /i /y /q "apps\desktop\out" "%UPD%\out" >nul || goto :fail
copy /y "apps\desktop\package.json" "%UPD%\package.json" >nul
copy /y "scripts\apply-update.ps1"  "%UPD%\apply-update.ps1" >nul
copy /y "scripts\apply-update.cmd"  "%UPD%\apply-update.cmd" >nul
copy /y "scripts\UPDATE-README.txt" "%UPD%\README.txt" >nul 2>nul
copy /y "scripts\Start AlphaConcept (Admin).cmd" "%UPD%\Start AlphaConcept (Admin).cmd" >nul 2>nul
copy /y "scripts\Set-AlphaConceptQoS.ps1" "%UPD%\Set-AlphaConceptQoS.ps1" >nul 2>nul
copy /y "scripts\Enable Real-Time Priority (Admin).cmd" "%UPD%\Enable Real-Time Priority (Admin).cmd" >nul 2>nul

echo === Zipping ===
powershell -NoProfile -Command "Compress-Archive -Path 'apps\desktop\release\update\*' -DestinationPath 'apps\desktop\release\update.zip' -Force"

echo.
echo Done.
echo   Folder: %CD%\%UPD%
echo   Zip   : %CD%\apps\desktop\release\update.zip
echo.
echo Copy the zip to the other PC, extract it, and run apply-update.cmd
goto :eof

:fail
echo.
echo BUILD FAILED - update package not created.
exit /b 1
