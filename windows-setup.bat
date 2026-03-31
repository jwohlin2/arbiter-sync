@echo off
cd /d "%~dp0"
echo === Arbiter Sync - Windows Setup ===
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found.
  echo Please install it from https://nodejs.org ^(LTS version^), then run this again.
  pause
  exit /b 1
)

echo Node.js found.
echo.

echo Installing dependencies...
npm install
if errorlevel 1 (
  echo ERROR: npm install failed. See above for details.
  pause
  exit /b 1
)
echo.

echo Installing Chromium ^(this may take a minute^)...
npx playwright install chromium
if errorlevel 1 (
  echo ERROR: Chromium install failed. See above for details.
  pause
  exit /b 1
)

echo.
echo === Setup complete! ===
echo Double-click ArbiterSync.vbs to launch the app.
echo.
pause
