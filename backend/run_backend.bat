@echo off
echo ========================================================
echo Starting PRIVACY GATEWAY - FastAPI Python Backend
echo ========================================================

cd /d "%~dp0"

REM Check Python installation
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH!
    echo Please install Python 3.10+ and add it to your PATH.
    pause
    exit /b 1
)

REM Create virtual environment if it doesn't exist
if not exist "venv" (
    echo Creating Python virtual environment...
    python -m venv venv
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Install dependencies
echo Installing required dependencies from requirements.txt...
pip install -r requirements.txt

REM Start FastAPI with Uvicorn on 0.0.0.0:8000
echo.
echo ========================================================
echo Privacy Gateway FastAPI is running on:
echo http://localhost:8000
echo Health Check: http://localhost:8000/health
echo Swagger Docs: http://localhost:8000/docs
echo ========================================================
echo.
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause
