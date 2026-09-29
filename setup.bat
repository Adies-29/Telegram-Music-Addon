@echo off
title Telegram Music Addon Setup
cd /d "%~dp0"

echo ===================================================
echo             Telegram Music Addon Setup
echo ===================================================
echo.

if not exist node_modules (
    echo Installing dependencies...
    call npm install
)

echo Starting server and opening setup wizard in browser...
echo.
set "OPEN_BROWSER=true"
call npm start

pause
