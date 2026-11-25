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
echo   R0_新电脑安装并启动.bat
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [缺少] 未安装 Node.js，请先运行 R0_新电脑安装并启动.bat
  pause
  exit /b 1
)

if not exist "DEV\node_modules" (
  echo [提示] 未找到 DEV\node_modules，改为执行安装脚本...
  call "%~dp0R0_新电脑安装并启动.bat"
  exit /b %errorlevel%
)

:: 每次启动都编译 engine，避免源码有新方法但 dist 过期导致服务端崩溃
echo [编译] packages/engine ...
pushd "%~dp0DEV"
call npm run build --workspace=packages/engine
if errorlevel 1 (
  popd
  echo [错误] engine 编译失败
  pause
  exit /b 1
)
popd


cd /d "%~dp0DEV"
echo 启动 Server + Web ...
echo 浏览器: http://127.0.0.1:5173/
echo.

:: /D 指定工作目录，避免嵌套引号导致语法错误
start "Cata Raid Sim - Server" /D "%~dp0DEV" cmd /k "npm run dev --workspace=packages/server"
timeout /t 2 /nobreak >nul
echo 请手动打开浏览器访问: http://127.0.0.1:5173/
call npm run dev --workspace=packages/web

pause
endlocal
