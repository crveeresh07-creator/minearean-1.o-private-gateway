@echo off
echo ========================================================
echo Starting PRIVACY GATEWAY - React Frontend
echo ========================================================

cd /d "%~dp0\.."

REM Check Node.js installation
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

REM Install npm packages if node_modules missing
if not exist "node_modules" (
    echo Installing npm dependencies...
    npm install
)

REM Start frontend dev server
echo Starting dev server on http://localhost:3000...
npm run dev
pause
