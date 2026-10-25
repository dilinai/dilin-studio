@echo off
rem Dilin Studio - Windows start file: double-click to open http://localhost:41730 in your browser.
rem Uses the PowerShell that comes with Windows; nothing to install. Close this window to stop.
cd /d "%~dp0"
rem Node installed: use the Node server (it also opens the local MCP for your AI); otherwise PowerShell.
where node >nul 2>nul
if not errorlevel 1 (
  node "%~dp0tools\serve.mjs"
  if errorlevel 1 pause
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1"
if errorlevel 1 pause
