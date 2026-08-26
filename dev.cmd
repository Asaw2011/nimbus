@echo off
REM Launch the Vite dev server with Node on PATH (harness shell predates the Node install).
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
call npm run dev
