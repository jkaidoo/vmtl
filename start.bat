@echo off
setlocal
cd /d "%~dp0"

REM ============================================================
REM  UITS Vehicle Management & Trip Logging - local dev launcher
REM  Starts the Laravel API (:8000) and the Vite frontend (:5173)
REM ============================================================

REM Put PHP, Composer, MySQL and Node on PATH for this session.
set "PATH=C:\tools\php83;C:\tools\mysql\current\bin;C:\ProgramData\ComposerSetup\bin;C:\Program Files\nodejs;%PATH%"

echo.
echo   UITS VMTL - starting local servers...
echo   ------------------------------------------------

REM Make sure the MySQL service is running (ignored if already up / no admin).
net start MySQL >nul 2>&1

REM Backend - Laravel API on http://127.0.0.1:8000
start "UITS VMTL - Backend (Laravel :8000)" cmd /k "cd /d "%~dp0backend" && php artisan serve --host=127.0.0.1 --port=8000"

REM Frontend - Vite dev server on http://localhost:5173
start "UITS VMTL - Frontend (Vite :5173)" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo   Backend : http://127.0.0.1:8000
echo   Frontend: http://localhost:5173
echo.
echo   Two terminal windows have opened (one per server).
echo   Close those windows to stop the servers.
echo.

REM Give Vite a moment to boot, then open the app in the browser.
timeout /t 4 >nul
start "" http://localhost:5173

endlocal
