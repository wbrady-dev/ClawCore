@echo off
REM ThreadClaw Backup Script (Windows)
REM Creates hot backups of both databases using SQLite VACUUM INTO.
REM Safe to run while services are active (WAL mode).
REM
REM Usage: scripts\backup.bat [backup_dir]
REM Default: %USERPROFILE%\backups\threadclaw\YYYY-MM-DD

setlocal enabledelayedexpansion

set "BACKUP_ROOT=%~1"
if "%BACKUP_ROOT%"=="" set "BACKUP_ROOT=%USERPROFILE%\backups\threadclaw"

for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%a"
set "BACKUP_DIR=%BACKUP_ROOT%\%TODAY%"

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo ThreadClaw Backup — %date% %time%
echo Destination: %BACKUP_DIR%
echo.

REM Find databases
set "THREADCLAW_DB=%USERPROFILE%\.openclaw\services\threadclaw\data\threadclaw.db"
set "MEMORY_DB=%USERPROFILE%\.openclaw\threadclaw-memory.db"

REM Check for sqlite3
where sqlite3 >nul 2>&1
if errorlevel 1 (
    echo   Using Node.js for backup ^(sqlite3 CLI not found^)...

    if exist "%THREADCLAW_DB%" (
        echo   Backing up threadclaw.db...
        copy /Y "%THREADCLAW_DB%" "%BACKUP_DIR%\threadclaw.db" >nul
        echo   Done ^(file copy — stop services for consistent backup^)
    )

    if exist "%MEMORY_DB%" (
        echo   Backing up threadclaw-memory.db...
        copy /Y "%MEMORY_DB%" "%BACKUP_DIR%\threadclaw-memory.db" >nul
        echo   Done ^(file copy — stop services for consistent backup^)
    )

    goto :done
)

REM Backup ThreadClaw knowledge DB
if exist "%THREADCLAW_DB%" (
    echo   Backing up threadclaw.db...
    sqlite3 "%THREADCLAW_DB%" "VACUUM INTO '%BACKUP_DIR%\threadclaw.db'"
    echo   Done
) else (
    echo   threadclaw.db not found
)

REM Backup Memory Engine DB
if exist "%MEMORY_DB%" (
    echo   Backing up threadclaw-memory.db...
    sqlite3 "%MEMORY_DB%" "VACUUM INTO '%BACKUP_DIR%\threadclaw-memory.db'"
    echo   Done
) else (
    echo   threadclaw-memory.db not found
)

:done
REM Prune backups older than 30 days
powershell -NoProfile -Command "Get-ChildItem '%BACKUP_ROOT%' -Directory | Where-Object { $_.CreationTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Recurse -Force" 2>nul

echo.
echo Backup complete.
