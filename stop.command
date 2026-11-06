#!/bin/bash
# 停止阅读器，直到下次登录或重启电脑。
# 若要取消登录自启，请改运行 ./service.sh uninstall
cd "$(dirname "$0")"

bash ./service.sh stop
status=$?

if [ -t 0 ]; then
  echo
  read -r -p "按 Enter 关闭此窗口..."
fi
exit "$status"
