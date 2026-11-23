@echo off
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
  rem pause
  exit /b 1
)

if not exist "DEV\node_modules" (
  echo [提示] 未找到 DEV\node_modules，改为执行安装脚本...
  call "%~dp0R0_新电脑安装并启动.bat"
  exit /b %errorlevel%
)

echo [SMOKE] parse OK
exit /b 0
