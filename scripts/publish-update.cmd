@echo off
REM Builds the in-place update package (via make-update.cmd) and publishes it to
REM the Vercel site's downloads folder as a versioned zip, so it can be linked
REM from site\updates.html and served statically.
REM
REM After running this: add a release entry for the new version near the top of
REM site\updates.html (copy the "release latest" block), then commit + push -
REM Vercel redeploys automatically.

setlocal
cd /d "%~dp0.."

echo === Building update package ===
call "scripts\make-update.cmd" || goto :fail

for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Get-Content apps\desktop\package.json -Raw | ConvertFrom-Json).version"`) do set VER=%%v

if "%VER%"=="" (
  echo Could not read version from apps\desktop\package.json
  goto :fail
)

if not exist "site\downloads" mkdir "site\downloads"
copy /y "apps\desktop\release\update.zip" "site\downloads\AlphaConcept-Update-%VER%.zip" >nul || goto :fail

echo.
echo Published: site\downloads\AlphaConcept-Update-%VER%.zip
echo.
echo NEXT STEPS
echo   1. Edit site\updates.html - add a release entry for %VER% at the top
echo      (copy the block with class "release latest"; remove "latest" from the
echo       previous entry and drop its "Latest" tag).
echo   2. git add site/downloads/AlphaConcept-Update-%VER%.zip site/updates.html
echo   3. git commit and push - Vercel redeploys the updates page automatically.
goto :eof

:fail
echo.
echo FAILED - update was not published.
exit /b 1
