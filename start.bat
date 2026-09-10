@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"

echo ==========================================
echo   Markdown 阅读器
echo ==========================================

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo.
    echo [Error] 未安装 Node.js。
    echo 请从 https://nodejs.org/ 安装 Node.js ^(v14+^)。
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do echo [OK] 已检测到 Node.js %%v

if not exist "Src\node_modules" (
    echo [...] 正在安装依赖...
    pushd Src
    call npm install --silent
    if %ERRORLEVEL% neq 0 (
        echo [Error] 依赖安装失败。
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK] 依赖安装完成
) else (
    echo [OK] 依赖已安装
)

if not exist "config.jsonc" if not exist "config.json" (
    echo [...] 未找到 config.jsonc，正在从 config.example.jsonc 复制...
    copy /Y config.example.jsonc config.jsonc >nul
    echo [OK] 已生成 config.jsonc，请按需修改 booksRoot
)

if not exist "Books" mkdir Books

echo.
echo 正在启动服务... 关闭本窗口或按 Ctrl+C 停止。
echo.

node Src\server.js --open
pause
