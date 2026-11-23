@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "HAS_CHANGES="
for /f "delims=" %%i in ('git status --porcelain') do set "HAS_CHANGES=1"

if defined HAS_CHANGES (
    echo [提醒] 你本地有尚未上传的改动：
    git status -s
    echo.
    echo 建议先运行 "G2_上传到GitHub.bat"，防止代码冲突。
    echo 【警告】输入 f 会直接丢弃本地所有改动，强制拉远程版本！
    set /p "CONFIRM=仍要尝试直接拉取吗？输入 y 普通拉取 / f 强制覆盖 / 其他键取消: "
    if /i "!CONFIRM!"=="f" (
        echo 正在丢弃本地修改，强制同步远程main分支...
        git reset --hard origin/main
        goto finish
    )
    if /i not "!CONFIRM!"=="y" (
        echo 已取消下载。
        pause
        exit /b 0
    )
)

echo 正在从 GitHub 同步最新代码到本地...
git pull origin main
:finish
if errorlevel 1 (
    echo.
    echo 同步失败，请把窗口里的报错发给我帮你处理。
) else (
    echo.
    echo 同步完成！如果这次新增了依赖包，请在目录里运行一次 npm install。
)
pause
