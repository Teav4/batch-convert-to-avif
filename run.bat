@echo off
echo AVIF Conversion Tool
echo ==========================================

if "%~1"=="" (
  echo Error: Please provide a source directory path.
  echo Usage: run.bat ^<source_directory^> [workers=N]
  exit /b 1
)

set SOURCE=%~1
set WORKERS_ARG=

if not "%~2"=="" (
  set WORKERS_ARG=--workers=%~2
)

echo Starting conversion from "%SOURCE%"
echo Using workers: %~2

deno run --allow-read --allow-write --allow-run --allow-env src/main.ts "%SOURCE%" %WORKERS_ARG%

echo Conversion completed.
pause