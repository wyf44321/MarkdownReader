#!/bin/bash
# Markdown 阅读器 - macOS 启动脚本
# 在访达中双击即可启动。
set -e
cd "$(dirname "$0")"

echo "=========================================="
echo "  Markdown 阅读器"
echo "=========================================="

if ! command -v node &> /dev/null; then
    echo ""
    echo "[Error] 未安装 Node.js。"
    echo "请从 https://nodejs.org/ 安装 Node.js (v14+)，"
    echo "或使用 Homebrew: brew install node"
    echo ""
    read -p "按 Enter 退出..."
    exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 14 ] 2>/dev/null; then
    echo "[Error] 需要 Node.js v14+，当前: $(node -v)"
    read -p "按 Enter 退出..."
    exit 1
fi

echo "[OK] 已检测到 Node.js $(node -v)"

if [ ! -d "Src/node_modules" ]; then
    echo "[...] 正在安装依赖..."
    (cd Src && npm install --silent)
    echo "[OK] 依赖安装完成"
else
    echo "[OK] 依赖已安装"
fi

if [ ! -f "config.jsonc" ] && [ ! -f "config.json" ]; then
    echo "[...] 未找到 config.jsonc，正在从 config.example.jsonc 复制..."
    cp config.example.jsonc config.jsonc
    echo "[OK] 已生成 config.jsonc，请按需修改 booksRoot"
fi

mkdir -p Books

echo ""
echo "正在启动服务... 关闭本窗口或按 Ctrl+C 停止。"
echo ""

node Src/server.js --open
