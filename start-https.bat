@echo off
title Telegram Music with HTTPS Tunnel
cd /d "%~dp0"

echo ===================================================
echo     Telegram Music Addon (HTTPS Tunnel Mode)
echo ===================================================
echo.
echo Starting Telegram Music on port 3000...
start "Telegram Music Server" node --max-old-space-size=128 index.js

timeout /t 2 /nobreak >nul

echo.
echo Starting Cloudflare HTTPS Tunnel...
echo Look for the https://*.trycloudflare.com link below!
echo.
cloudflared tunnel --url http://localhost:3000

pause
