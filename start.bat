@echo off
setlocal
cd /d "%~dp0"

REM ============================================================
REM  UITS Vehicle Management & Trip Logging - local dev launcher
REM  Node.js + Express + PostgreSQL (embedded pglite by default).
REM  Single server serves the API and the static front-end.
REM ============================================================

set "PATH=C:\Program Files\nodejs;%PATH%"

echo.
echo   UITS VMTL - starting local server...
echo   ------------------------------------------------

cd /d "%~dp0app-js"

REM Install dependencies on first run.
if not exist "node_modules" (
  echo   Installing dependencies...
  call npm install
)

REM Seed the database on first run (idempotent).
node scripts\seed.js

REM Start the app on http://127.0.0.1:8000 (API + front-end).
start "UITS VMTL (Node :8000)" cmd /k "cd /d "%~dp0app-js" && npm start"

echo.
echo   App: http://127.0.0.1:8000
echo.
echo   Sign in with admin@uits.test / password
echo.

timeout /t 4 >nul
start "" http://127.0.0.1:8000

endlocal
