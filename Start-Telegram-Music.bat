@echo off
title Telegram Music
cd /d "%~dp0"
node --max-old-space-size=128 index.js
pause
