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

if not exist node_modules (
  echo 正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败。
    pause
    exit /b 1
  )
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
start "" msedge --app=%APP_URL%
if errorlevel 1 start "" chrome --app=%APP_URL%
if errorlevel 1 start "" %APP_URL%

node server.js
pause
