@echo off
echo ========================================================
echo Starting Cloudflare Tunnel for FastAPI Backend
echo Exposes http://127.0.0.1:8000 securely over HTTPS
echo ========================================================
echo.
echo Running: npx cloudflared tunnel --url http://127.0.0.1:8000
echo.
echo NOTE: Copy the generated https://*.trycloudflare.com address
echo and paste it into the Gateway Settings tab!
echo.
npx --yes cloudflared tunnel --url http://127.0.0.1:8000
pause
