@echo off
setlocal enabledelayedexpansion
title ClawCore - Installer

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

cd /d "%SCRIPT_DIR%"

echo.
echo  ========================================
echo   ClawCore - Guided Installer
echo  ========================================
echo.
echo   This script bootstraps local dependencies and then
echo   launches the current guided ClawCore installer.
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo         Install Node.js 22+ from https://nodejs.org/
    pause
    exit /b 1
)

for /f %%m in ('node -e "console.log(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%m
if %NODE_MAJOR% LSS 22 (
    echo [ERROR] Node.js %NODE_MAJOR% detected. ClawCore requires Node.js 22+.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not on PATH.
    echo         Install Python 3 and enable "Add to PATH", then try again.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('python --version') do echo [OK] %%v

if not exist "%SCRIPT_DIR%\node_modules" (
    echo.
    echo [bootstrap] Installing local Node.js dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
    set "CLAWCORE_SKIP_NODE_INSTALL=1"
) else (
    echo [OK] Local Node.js dependencies already present
)

echo.
echo [launch] Starting the guided installer...
echo.
node "%SCRIPT_DIR%\bin\clawcore.mjs" install %*
set "EXIT_CODE=%ERRORLEVEL%"

if %EXIT_CODE% neq 0 (
    echo.
    echo [ERROR] Installer exited with code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
