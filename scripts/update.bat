@echo off
title ClawCore - Update
cd /d "%~dp0\.."

echo [update] Pulling latest from GitHub...
git pull
if %errorlevel% neq 0 (
    echo [ERROR] git pull failed.
    pause
    exit /b 1
)

echo [update] Rebuilding...
call npx tsup
if %errorlevel% neq 0 (
    echo [WARN] Build failed. TUI will use tsx fallback.
)

echo.
echo [OK] ClawCore updated. Restart the TUI to see changes.
