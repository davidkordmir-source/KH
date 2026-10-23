@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24 or newer from https://nodejs.org/ and try again.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 or newer is required.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist node_modules\express\package.json (
  call npm ci --omit=dev --no-audit --no-fund --cache "%TEMP%\dideban-npm-cache"
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node --env-file-if-exists=.env launch.mjs
pause
