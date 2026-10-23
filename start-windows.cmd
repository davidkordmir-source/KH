@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo Dideban - starting your newsroom
echo.
if not exist server\index.mjs goto incomplete
if not exist dist\index.html goto incomplete
if exist runtime\node.exe (
  set "DIDEBAN_NODE=%~dp0runtime\node.exe"
  goto runtimeReady
)
where node >nul 2>&1
if errorlevel 1 goto missingRuntime
set "DIDEBAN_NODE=node"
:runtimeReady
"%DIDEBAN_NODE%" -e "if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 or newer is required.');process.exit(1)}"
if errorlevel 1 goto failed
if not exist node_modules\express\package.json goto dependencies
if not exist node_modules\fast-xml-parser\package.json goto dependencies
if not exist node_modules\undici\package.json goto dependencies
goto launch
:dependencies
if exist runtime\node.exe goto incomplete
where npm >nul 2>&1
if errorlevel 1 goto missingRuntime
echo Installing dependencies for the source edition...
call npm ci --omit=dev --no-audit --no-fund --cache "%TEMP%\dideban-npm-cache"
if errorlevel 1 goto failed
:launch
"%DIDEBAN_NODE%" --env-file-if-exists=.env launch.mjs
if errorlevel 1 goto failed
exit /b 0
:incomplete
echo The application files are incomplete.
echo Right-click the downloaded ZIP and choose Extract All, then run this file from the extracted folder.
goto failed
:missingRuntime
echo For an installation-free start, download the Windows portable edition with its included runtime.
echo The source edition requires Node.js 24 or newer from https://nodejs.org/.
:failed
echo.
echo If available, the diagnostic log is at %%LOCALAPPDATA%%\Dideban\startup.log
pause
exit /b 1
