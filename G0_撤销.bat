@echo off
cd /d "%~dp0"

echo 正在清除刚才填错的 Git 用户名和邮箱...
git config --global --unset-all user.name 2>nul
git config --global --unset-all user.email 2>nul

if exist ".git" (
    echo 正在删除本地 .git 记录（不会删你的任何代码文件）...
    attrib -h -r -s ".git" /s /d >nul 2>nul
    rmdir /s /q ".git"
)

echo.
echo 重置完成！现在可以重新双击运行 "G1_首次上传.bat" 了。
pause
