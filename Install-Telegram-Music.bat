@echo off
title Telegram Music Addon Installer

echo ===================================================
echo           Telegram Music Addon Installer
echo ===================================================
echo.

:: Ensure System32 and PowerShell are in PATH
set "PATH=%SystemRoot%\System32;%SystemRoot%\System32\WindowsPowerShell\v1.0;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%APPDATA%\npm;%PATH%"

:: 1. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 goto :INSTALL_NODE
goto :NODE_OK

:INSTALL_NODE
echo [INFO] Node.js is not detected on this system.
echo Starting automated Node.js installation...
echo.

where winget >nul 2>nul
if %errorlevel% equ 0 goto :USE_WINGET
goto :USE_POWERSHELL

:USE_WINGET
echo [1/2] Installing Node.js LTS via Windows Package Manager...
winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
goto :CHECK_NODE_INSTALLED

:USE_POWERSHELL
echo [1/2] Downloading Node.js installer (30 MB, please wait)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'Continue'; $msi = Join-Path $env:TEMP 'nodejs_setup.msi'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi', $msi)"

echo.
echo [2/2] Installing Node.js package in background (takes ~20-30s)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$msi = Join-Path $env:TEMP 'nodejs_setup.msi'; Start-Process msiexec.exe -ArgumentList '/i', $msi, '/qn', '/norestart' -Wait; Remove-Item $msi -Force"
goto :CHECK_NODE_INSTALLED

:CHECK_NODE_INSTALLED
set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%APPDATA%\npm;%PATH%"
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Automated Node.js installation could not complete automatically.
    echo Opening https://nodejs.org in your browser...
    start https://nodejs.org/en/download
    pause
    exit /b 1
)
echo.
echo [OK] Node.js successfully installed and ready!
echo.

:NODE_OK
for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
echo [OK] Node.js detected: %NODE_VER%
echo.

:: 2. Determine target directory
set "CURR_DIR=%~dp0"
if "%CURR_DIR:~-1%"=="\" set "CURR_DIR=%CURR_DIR:~0,-1%"

if exist "%CURR_DIR%\package.json" (
    set "TARGET_DIR=%CURR_DIR%"
) else (
    set "TARGET_DIR=%CURR_DIR%\Telegram-Music-Addon"
)

:: 3. Download or clone project if not already present
if exist "%TARGET_DIR%\package.json" goto :PKG_OK

echo [INFO] Downloading Telegram Music Addon from GitHub...
where git >nul 2>nul
if %errorlevel% equ 0 goto :USE_GIT
goto :USE_PS_DOWNLOAD

:USE_GIT
git clone https://github.com/Imnotshashwat/Telegram-Music-Addon.git "%TARGET_DIR%"
goto :PKG_OK

:USE_PS_DOWNLOAD
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'Continue'; $tmpZip = Join-Path $env:TEMP 'Telegram-Music-Addon.zip'; $tmpDir = Join-Path $env:TEMP 'TeleMusicExtract'; New-Item -ItemType Directory -Force -Path '%TARGET_DIR%' | Out-Null; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://github.com/Imnotshashwat/Telegram-Music-Addon/archive/refs/heads/main.zip', $tmpZip); Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force; Copy-Item -Path ($tmpDir + '\Telegram-Music-Addon-main\*') -Destination '%TARGET_DIR%' -Recurse -Force; Remove-Item -Path $tmpZip, $tmpDir -Recurse -Force"

:PKG_OK
if not exist "%TARGET_DIR%\package.json" (
    echo.
    echo [ERROR] Failed to download Telegram Music Addon. Please check your internet connection.
    pause
    exit /b 1
)

cd /d "%TARGET_DIR%"

:: 4. Install dependencies
if exist "node_modules" goto :DEPS_OK

echo.
echo [INFO] Installing NPM dependencies (this takes 30-60 seconds on first run)...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install encountered an issue.
    pause
    exit /b 1
)

:DEPS_OK
:: 5. Create launcher & shortcut
if exist "Start-Telegram-Music.bat" goto :SHORTCUT_OK

(
    echo @echo off
    echo title Telegram Music
    echo cd /d "%%~dp0"
    echo node --max-old-space-size=128 index.js
    echo pause
) > "Start-Telegram-Music.bat"

:SHORTCUT_OK
powershell -NoProfile -ExecutionPolicy Bypass -Command "$sh = New-Object -ComObject WScript.Shell; $desktop = [System.Environment]::GetFolderPath('Desktop'); $lnk = $sh.CreateShortcut($desktop + '\Telegram Music.lnk'); $lnk.TargetPath = '%TARGET_DIR%\Start-Telegram-Music.bat'; $lnk.WorkingDirectory = '%TARGET_DIR%'; $lnk.WindowStyle = 1; $lnk.Save()"

echo [OK] Desktop shortcut created. Use "Telegram Music" on your Desktop to start next time.

echo.
echo ===================================================
echo [SUCCESS] Setup complete! Starting Telegram Music...
echo Opening http://localhost:3000/setup in your browser
echo ===================================================
echo.

set "OPEN_BROWSER=true"
call npm start
pause
