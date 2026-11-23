@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

title Cata Raid Sim - 日常启动
echo ========================================
echo   大灾变副本模拟器 - 日常启动
echo ========================================
echo.
echo 若是新电脑第一次跑，请先双击：
echo   0_新电脑安装并启动.bat
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [缺少] 未安装 Node.js，请先运行 0_新电脑安装并启动.bat
  pause
  exit /b 1
)

if not exist "DEV\node_modules" (
  echo [提示] 未找到 DEV\node_modules，改为执行安装脚本...
  call "%~dp00_新电脑安装并启动.bat"
  exit /b %errorlevel%
)

if not exist "DEV\packages\engine\dist\index.js" (
  echo [提示] engine 尚未编译，正在编译...
  cd /d "%~dp0DEV"
  call npm run build --workspace=packages/engine
  if errorlevel 1 (
    echo [错误] engine 编译失败
    pause
    exit /b 1
  )
)

cd /d "%~dp0DEV"
echo 启动 Server + Web ...
echo 浏览器: http://127.0.0.1:5173/
echo.

start "Cata Raid Sim - Server" cmd /k "cd /d \"%~dp0DEV\" && npm run dev --workspace=packages/server"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:5173/"
call npm run dev --workspace=packages/web

pause
endlocal
