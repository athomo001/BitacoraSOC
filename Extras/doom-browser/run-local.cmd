@echo off
setlocal
cd /d "%~dp0"
set PORT=5173
echo.
echo Sirviendo en http://127.0.0.1:%PORT%/
echo Carpeta: %CD%
echo Ctrl+C para detener.
echo.

where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python -m http.server %PORT%
  exit /b %ERRORLEVEL%
)

where node >nul 2>nul
if %ERRORLEVEL%==0 (
  REM En CMD, "pnpm" usa pnpm.cmd y no choca con ExecutionPolicy de PowerShell
  call pnpm dlx serve -l %PORT%
  exit /b %ERRORLEVEL%
)

echo No se encontro python ni node en PATH.
pause
exit /b 1
