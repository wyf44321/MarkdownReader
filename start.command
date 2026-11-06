#!/bin/bash
# Markdown 阅读器 - macOS 启动脚本
# 双击后注册为后台服务并打开浏览器。关闭本窗口不会停止阅读器。
cd "$(dirname "$0")"

if ! bash ./service.sh start; then
  echo
  if [ -t 0 ]; then
    read -r -p "按 Enter 关闭此窗口..."
  fi
  exit 1
fi

if [ -t 0 ]; then
  echo
  read -r -p "按 Enter 关闭此窗口..."
fi
