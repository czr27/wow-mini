@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Git，请确认已安装 Git 并重启电脑后再试。
    pause
    exit /b 1
)

set "GIT_NAME="
for /f "delims=" %%i in ('git config user.name 2^>nul') do set "GIT_NAME=%%i"
if "!GIT_NAME!"=="" (
    set /p "INPUT_NAME=首次使用 Git，请输入你的 GitHub 用户名: "
    git config --global user.name "!INPUT_NAME!"
)

set "GIT_EMAIL="
for /f "delims=" %%i in ('git config user.email 2^>nul') do set "GIT_EMAIL=%%i"
if "!GIT_EMAIL!"=="" (
    set /p "INPUT_EMAIL=请输入你的 GitHub 注册邮箱: "
    git config --global user.email "!INPUT_EMAIL!"
)

if not exist ".gitignore" (
    echo 正在自动生成 .gitignore（忽略依赖和编译缓存）...
    (
        echo # Dependencies
        echo node_modules/
        echo .pnpm-store/
        echo.
        echo # Build and TypeScript caches
        echo dist/
        echo build/
        echo out/
        echo .vite/
        echo .cache/
        echo .parcel-cache/
        echo .turbo/
        echo .next/
        echo *.tsbuildinfo
        echo coverage/
        echo.
        echo # Env and logs
        echo .env
        echo .env.local
        echo .env.*.local
        echo *.log
        echo npm-debug.log*
        echo yarn-debug.log*
        echo pnpm-debug.log*
        echo.
        echo # OS and IDE
        echo .DS_Store
        echo Thumbs.db
        echo .idea/
        echo .vscode/
    ) > .gitignore
) else (
    echo 已检测到现有 .gitignore，保持原有配置。
)

echo.
set "REPO_URL="
set /p "REPO_URL=请粘贴刚才复制的 GitHub 仓库地址（https://github.com/xxx/xxx.git）: "
if "!REPO_URL!"=="" (
    echo 未输入仓库地址，已取消。
    pause
    exit /b 1
)

if not exist ".git" (
    git init
)
git branch -M main
git remote remove origin 2>nul
git remote add origin "!REPO_URL!"

echo.
echo 正在打包代码（已自动跳过 node_modules 和编译缓存）...
git add .
git commit -m "init: initial upload"

echo.
echo 正在上传到 GitHub（首次运行会弹出浏览器登录授权窗口，点击授权即可）...
git push -u origin main
if errorlevel 1 (
    echo.
    echo 上传失败，请把窗口里的报错内容发给我排查。
) else (
    echo.
    echo 首次上传成功！接下来可以直接导入这个 GitHub 仓库了。
)
pause
