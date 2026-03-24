@echo off
setlocal enabledelayedexpansion
title ThreadClaw - Uninstaller

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

cd /d "%SCRIPT_DIR%"

echo.
echo  ========================================
echo   ThreadClaw - Guided Uninstaller
echo  ========================================
echo.
echo   This script launches the current guided
echo   ThreadClaw uninstaller from this checkout.
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is required to run the guided uninstaller.
    pause
    exit /b 1
)

if not exist "%SCRIPT_DIR%\node_modules" if not exist "%SCRIPT_DIR%\dist\cli\threadclaw.js" (
    echo [ERROR] ThreadClaw runtime files are missing.
    echo         Reinstall local dependencies or use manual cleanup.
    pause
    exit /b 1
)

node "%SCRIPT_DIR%\bin\threadclaw.mjs" uninstall %*
set "EXIT_CODE=%ERRORLEVEL%"

if %EXIT_CODE% neq 0 (
    echo.
    echo [ERROR] Uninstaller exited with code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
