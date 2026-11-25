@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

title Cata Raid Sim - 新电脑安装并启动
echo ========================================
echo   大灾变副本模拟器 - 新电脑一键安装启动
echo ========================================
echo.
echo 本脚本会：
echo   1. 检查是否已安装 Node.js（需要 18+）
echo   2. 在 DEV\ 下执行 npm install
echo   3. 编译 engine
echo   4. 启动联机服务端 + 前端（浏览器打开）
echo.
echo ----------------------------------------

:: ---- 检查 Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo [缺少] 未检测到 Node.js
  echo.
  echo 请先安装 Node.js LTS（推荐 20.x 或 22.x）：
  echo   https://nodejs.org/
  echo.
  echo 安装时勾选 "Add to PATH"，装完后重新打开本 bat。
  echo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
echo [OK] Node.js %NODE_VER%
where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 找到 node 但找不到 npm，请重装 Node.js LTS。
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('npm -v') do set "NPM_VER=%%v"
echo [OK] npm %NPM_VER%
echo.

if not exist "DEV\package.json" (
  echo [错误] 找不到 DEV\package.json
  echo 请确认本 bat 放在仓库根目录（与 DEV、DOCS 同级）。
  pause
  exit /b 1
)

:: ---- 安装依赖 ----
echo [1/3] 安装依赖（首次较慢，请耐心等待）...
cd /d "%~dp0DEV"
call npm install
if errorlevel 1 (
  echo.
  echo [错误] npm install 失败。可检查网络，或换镜像后再试：
  echo   npm config set registry https://registry.npmmirror.com
  pause
  exit /b 1
)
echo.

:: ---- 编译 engine ----
echo [2/3] 编译 packages/engine ...
call npm run build --workspace=packages/engine
if errorlevel 1 (
  echo.
  echo [错误] engine 编译失败，请查看上方报错。
  pause
  exit /b 1
)
echo.

:: ---- 启动 ----
echo [3/3] 启动服务...
echo   - 新窗口：联机 Server（WebSocket / 账号 API）
echo   - 本窗口：前端 Vite（浏览器）
echo.
echo 启动后浏览器一般打开：http://127.0.0.1:5173/
echo 关掉窗口即可停止对应服务。
echo ----------------------------------------
echo.

:: /D 指定工作目录，避免嵌套引号导致语法错误
start "Cata Raid Sim - Server" /D "%~dp0DEV" cmd /k "npm run dev --workspace=packages/server"
timeout /t 2 /nobreak >nul

echo 请手动打开浏览器访问: http://127.0.0.1:5173/
call npm run dev --workspace=packages/web

echo.
echo 前端已退出。
pause
endlocal
