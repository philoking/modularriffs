@echo off
REM Serve Modular Riffs on localhost so Chrome/Edge will grant Web MIDI access.
REM (Web MIDI needs a "secure context"; http://localhost counts, file:// does not.)
REM Double-click this file, or run:  serve.cmd [port]
setlocal
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8765"
set "URL=http://localhost:%PORT%/"
cd /d "%~dp0"

REM Find a Python 3 interpreter (py launcher, then python, then python3).
set "PY="
for %%P in (py python python3) do (
  if not defined PY (
    where %%P >nul 2>nul && set "PY=%%P"
  )
)
if not defined PY (
  echo.
  echo Python 3 was not found. Install it from https://www.python.org/downloads/
  echo ^(tick "Add python.exe to PATH" during setup^), then run this again.
  echo.
  pause
  exit /b 1
)
if /I "%PY%"=="py" set "PY=py -3"

echo Modular Riffs  -^>  %URL%
echo Open in Chrome or Edge. Close this window to stop.
start "" "%URL%"
%PY% -m http.server %PORT%
