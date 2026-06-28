@echo off
setlocal
title 灵感追踪
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js LTS: https://nodejs.org/
  pause
  exit /b 1
)

echo 正在安装或更新依赖...
call npm install
if errorlevel 1 (
  echo 依赖安装失败。
  pause
  exit /b 1
)

echo 正在构建前端...
call npm run build
if errorlevel 1 (
  echo 前端构建失败。
  pause
  exit /b 1
)

set DESKTOP_MODE=1
set PORT=3001
set APP_URL=http://localhost:%PORT%

echo 正在启动灵感追踪...
start "灵感追踪服务" /min cmd /c "set DESKTOP_MODE=1&& set PORT=%PORT%&& node server.js"

echo 正在等待本地服务就绪...
for /l %%i in (1,1,30) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing '%APP_URL%/api/status' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
  if not errorlevel 1 goto open_app
  timeout /t 1 /nobreak >nul
)

echo 本地服务启动超时，请查看后台服务窗口输出。
pause
exit /b 1

:open_app
where msedge >nul 2>nul
if not errorlevel 1 (
  start "" msedge --app=%APP_URL%
  exit /b 0
)

where chrome >nul 2>nul
if not errorlevel 1 (
  start "" chrome --app=%APP_URL%
  exit /b 0
)

start "" %APP_URL%
