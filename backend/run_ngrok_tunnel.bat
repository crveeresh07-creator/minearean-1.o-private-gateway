@echo off
echo ========================================================
echo Starting ngrok HTTPS Tunnel for FastAPI Backend
echo Exposes http://127.0.0.1:8000 securely over HTTPS
echo ========================================================
echo.
echo Running: npx ngrok http 8000
echo.
echo NOTE: Copy the generated https://*.ngrok-free.app address
echo and paste it into the Gateway Settings tab!
echo.
npx ngrok http 8000
pause
