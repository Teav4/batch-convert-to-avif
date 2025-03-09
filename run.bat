@echo off
echo AVIF Conversion Tool
echo ==========================================

if "%~1"=="" (
  echo Error: Please provide a source directory path.
  echo Usage: run.bat ^<source_directory^> [workers]
  exit /b 1
)

REM Lưu thư mục hiện tại
set CURRENT_DIR=%CD%

REM Xử lý đường dẫn nguồn
set SOURCE=%~1

REM Xử lý tham số worker
set WORKERS_ARG=
set WORKERS_VALUE=4

if not "%~2"=="" (
  set WORKERS_VALUE=%~2
  set WORKERS_ARG=--workers=%~2
) else (
  set WORKERS_ARG=--workers=%WORKERS_VALUE%
)

REM Kiểm tra xem đó có phải là đường dẫn tương đối hay không
if not exist "%SOURCE%\" (
  echo Error: Source directory "%SOURCE%" does not exist.
  exit /b 1
)

REM Chuyển đổi thành đường dẫn tuyệt đối
pushd "%SOURCE%" 2>nul
if errorlevel 1 (
  echo Error: Cannot access source directory "%SOURCE%"
  exit /b 1
)
set SOURCE_ABS=%CD%
popd

echo Starting conversion from "%SOURCE_ABS%"
echo Using workers: %WORKERS_VALUE%

REM Chạy với đường dẫn tuyệt đối đến main.ts trong thư mục convert
cd /d "%~dp0"
deno run --allow-read --allow-write --allow-run --allow-env src/main.ts "%SOURCE_ABS%" %WORKERS_ARG%

REM Quay trở lại thư mục ban đầu sau khi hoàn tất
cd /d "%CURRENT_DIR%"

echo Conversion completed.
pause