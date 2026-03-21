@echo off
REM ClawCore Backup Script (Windows)
REM Creates hot backups of both databases using SQLite VACUUM INTO.
REM Safe to run while services are active (WAL mode).
REM
REM Usage: scripts\backup.bat [backup_dir]
REM Default: %USERPROFILE%\backups\clawcore\YYYY-MM-DD

setlocal enabledelayedexpansion

set "BACKUP_ROOT=%~1"
if "%BACKUP_ROOT%"=="" set "BACKUP_ROOT=%USERPROFILE%\backups\clawcore"

for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%a"
set "BACKUP_DIR=%BACKUP_ROOT%\%TODAY%"

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo ClawCore Backup — %date% %time%
echo Destination: %BACKUP_DIR%
echo.

REM Find databases
set "CLAWCORE_DB=%USERPROFILE%\.openclaw\services\clawcore\data\clawcore.db"
set "MEMORY_DB=%USERPROFILE%\.openclaw\clawcore-memory.db"

REM Check for sqlite3
where sqlite3 >nul 2>&1
if errorlevel 1 (
    echo   Using Node.js for backup ^(sqlite3 CLI not found^)...

    if exist "%CLAWCORE_DB%" (
        echo   Backing up clawcore.db...
        copy /Y "%CLAWCORE_DB%" "%BACKUP_DIR%\clawcore.db" >nul
        echo   Done ^(file copy — stop services for consistent backup^)
    )

    if exist "%MEMORY_DB%" (
        echo   Backing up clawcore-memory.db...
        copy /Y "%MEMORY_DB%" "%BACKUP_DIR%\clawcore-memory.db" >nul
        echo   Done ^(file copy — stop services for consistent backup^)
    )

    goto :done
)

REM Backup ClawCore knowledge DB
if exist "%CLAWCORE_DB%" (
    echo   Backing up clawcore.db...
    sqlite3 "%CLAWCORE_DB%" "VACUUM INTO '%BACKUP_DIR%\clawcore.db'"
    echo   Done
) else (
    echo   clawcore.db not found
)

REM Backup Memory Engine DB
if exist "%MEMORY_DB%" (
    echo   Backing up clawcore-memory.db...
    sqlite3 "%MEMORY_DB%" "VACUUM INTO '%BACKUP_DIR%\clawcore-memory.db'"
    echo   Done
) else (
    echo   clawcore-memory.db not found
)

:done
REM Prune backups older than 30 days
powershell -NoProfile -Command "Get-ChildItem '%BACKUP_ROOT%' -Directory | Where-Object { $_.CreationTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Recurse -Force" 2>nul

echo.
echo Backup complete.
