@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ========== 当前本地改动 ==========
git status -s
echo ==================================
echo.

set "MSG="
set /p "MSG=请输入本次修改说明（直接回车默认填 update）: "
if "!MSG!"=="" set "MSG=update"

git add .
git commit -m "!MSG!"
if errorlevel 1 (
    echo.
    echo 没有新的改动需要提交，尝试推送已有记录...
)

git push origin main
if errorlevel 1 (
    echo.
    echo 上传失败！如果提示冲突或 rejected，请先运行 "G3_从GitHub下载.bat" 再上传。
) else (
    echo.
    echo 已成功同步到 GitHub！
)
pause
