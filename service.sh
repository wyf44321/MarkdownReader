#!/bin/bash
# Markdown 阅读器后台服务（macOS launchd）
#
# start     注册并启动。已在运行时只打开浏览器。
# stop      停止到下次登录。登录或重启电脑后会再启动。
# uninstall 取消登录自启并停止。
# status    查看状态。
# run       在当前终端前台运行，便于调试。
#
# launchd 不能直接执行「文稿」里的脚本，所以真正的启动器写在
# ~/Library/Application Support/MarkdownReader/run.sh。
# 启动器会 exec 到 node，进程一旦退出，launchd 会把它重新拉起。

set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
ROOT="$(cd "$(dirname "$SOURCE")" && pwd)"
LABEL="local.markdown-reader"
DOMAIN="gui/$(id -u)"
TARGET="${DOMAIN}/${LABEL}"
AGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST="${AGENTS_DIR}/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/MarkdownReader"
SUPPORT_DIR="${HOME}/Library/Application Support/MarkdownReader"
RUNNER="${SUPPORT_DIR}/run.sh"
NODE_RESOLVED=""

usage() {
  echo "用法: ./service.sh {start|stop|status|uninstall|run}"
}

xml_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

resolve_node() {
  local candidate
  if [ -n "${NODE_BIN:-}" ] && [ -x "${NODE_BIN}" ]; then
    echo "${NODE_BIN}"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  if [ -s "${HOME}/.nvm/nvm.sh" ]; then
    set +e
    # shellcheck disable=SC1090
    . "${HOME}/.nvm/nvm.sh" >/dev/null 2>&1
    set -e
    if command -v node >/dev/null 2>&1; then
      command -v node
      return 0
    fi
  fi
  return 1
}

prepare_runtime() {
  local node npm major
  node="$(resolve_node)" || {
    echo "[Error] 未安装 Node.js。" >&2
    echo "请从 https://nodejs.org/ 安装 Node.js (v14+)，或使用 Homebrew: brew install node" >&2
    return 1
  }
  major="$("$node" -v | sed 's/v//' | cut -d. -f1)"
  case "$major" in
    ''|*[!0-9]*)
      echo "[Error] 无法识别 Node.js 版本: $("$node" -v)" >&2
      return 1
      ;;
  esac
  if [ "$major" -lt 14 ]; then
    echo "[Error] 需要 Node.js v14+，当前: $("$node" -v)" >&2
    return 1
  fi
  echo "[OK] 已检测到 Node.js $("$node" -v)"
  npm="$(dirname "$node")/npm"
  if [ ! -d "${ROOT}/Src/node_modules" ]; then
    if [ ! -x "$npm" ]; then
      echo "[Error] 未找到 npm，无法安装依赖。" >&2
      return 1
    fi
    echo "[...] 正在安装依赖..."
    (cd "${ROOT}/Src" && "$npm" install --silent)
    echo "[OK] 依赖安装完成"
  else
    echo "[OK] 依赖已安装"
  fi
  if [ ! -f "${ROOT}/config.jsonc" ] && [ ! -f "${ROOT}/config.json" ]; then
    echo "[...] 未找到 config.jsonc，正在从 config.example.jsonc 复制..."
    cp "${ROOT}/config.example.jsonc" "${ROOT}/config.jsonc"
    echo "[OK] 已生成 config.jsonc，请按需修改 booksRoot"
  fi
  mkdir -p "${ROOT}/Books" "${ROOT}/logs" "$LOG_DIR"
  NODE_RESOLVED="$node"
}

is_loaded() {
  launchctl print "$TARGET" >/dev/null 2>&1
}

service_state() {
  launchctl print "$TARGET" 2>/dev/null | sed -n 's/^[[:space:]]*state = //p' | head -n 1
}

service_pid() {
  launchctl print "$TARGET" 2>/dev/null | sed -n 's/^[[:space:]]*pid = //p' | head -n 1
}

write_runner() {
  local node_bin="$1"
  local tmp root_q node_q server_q
  root_q="$(printf '%q' "$ROOT")"
  node_q="$(printf '%q' "$node_bin")"
  server_q="$(printf '%q' "${ROOT}/Src/server.js")"
  tmp="$(mktemp "${TMPDIR:-/tmp}/markdown-reader-run.XXXXXX")"
  cat > "$tmp" <<EOF
#!/bin/bash
# 由 launchd 调用。放在「文稿」目录外，系统才允许后台执行。
set -euo pipefail
cd ${root_q}
echo "\$(date '+%Y-%m-%d %H:%M:%S') 启动阅读器"
exec ${node_q} ${server_q} --port=3000
EOF
  printf '%s' "$tmp"
}

render_plist() {
  local node_bin="$1"
  local node_dir path_env log_out log_err script_esc work_esc tmp
  node_dir="$(dirname "$node_bin")"
  path_env="$(xml_escape "${node_dir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")"
  log_out="$(xml_escape "${LOG_DIR}/service.log")"
  log_err="$(xml_escape "${LOG_DIR}/service.err.log")"
  script_esc="$(xml_escape "$RUNNER")"
  work_esc="$(xml_escape "$SUPPORT_DIR")"
  tmp="$(mktemp "${TMPDIR:-/tmp}/markdown-reader.XXXXXX")"
  cat > "$tmp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${script_esc}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${work_esc}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${log_out}</string>
  <key>StandardErrorPath</key>
  <string>${log_err}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${path_env}</string>
    <key>LANG</key>
    <string>en_US.UTF-8</string>
  </dict>
</dict>
</plist>
EOF
  if ! plutil -lint "$tmp" >/dev/null; then
    echo "[Error] 生成的服务配置无效。" >&2
    rm -f "$tmp"
    return 1
  fi
  printf '%s' "$tmp"
}

warn_existing_reader() {
  local state body
  state="$(service_state || true)"
  if [ "$state" = "running" ]; then
    return 0
  fi
  body="$(curl -fsS --max-time 1 "http://127.0.0.1:3000/api/status" 2>/dev/null || true)"
  case "$body" in
    *'"booksRoot"'*)
      echo "[注意] 端口 3000 上已经有一个阅读器在运行，多半是之前用窗口启动的。"
      echo "       请先关掉那个终端窗口，否则后台服务会改用下一个端口。"
      ;;
  esac
}

load_agent() {
  local i err=""
  launchctl enable "$TARGET" >/dev/null 2>&1 || true
  for i in 1 2 3 4 5; do
    if is_loaded; then
      return 0
    fi
    err="$(launchctl bootstrap "$DOMAIN" "$PLIST" 2>&1)" || true
    if is_loaded; then
      return 0
    fi
    sleep 0.3
  done
  echo "[Error] 无法注册后台服务。" >&2
  if [ -n "$err" ]; then
    echo "$err" >&2
  fi
  return 1
}

install_agent() {
  local node_bin="$1"
  local runner_tmp plist_tmp need_reload=0
  mkdir -p "$AGENTS_DIR" "$LOG_DIR" "$SUPPORT_DIR" "${ROOT}/logs"
  runner_tmp="$(write_runner "$node_bin")"
  plist_tmp="$(render_plist "$node_bin")"
  if [ ! -f "$RUNNER" ] || ! cmp -s "$runner_tmp" "$RUNNER"; then
    need_reload=1
  fi
  if [ ! -f "$PLIST" ] || ! cmp -s "$plist_tmp" "$PLIST"; then
    need_reload=1
  fi
  if [ "$need_reload" -eq 1 ] && is_loaded; then
    launchctl bootout "$TARGET" >/dev/null 2>&1 || launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
    sleep 0.3
  fi
  cp "$runner_tmp" "$RUNNER"
  cp "$plist_tmp" "$PLIST"
  rm -f "$runner_tmp" "$plist_tmp"
  chmod 755 "$RUNNER"
  chmod 644 "$PLIST"
  if [ "$need_reload" -eq 1 ]; then
    : > "${LOG_DIR}/service.log"
    : > "${LOG_DIR}/service.err.log"
  fi
  load_agent
  launchctl kickstart "$TARGET" >/dev/null 2>&1 || true
}

wait_for_port() {
  local i port body
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40; do
    if [ -f "${ROOT}/logs/port" ]; then
      port="$(tr -d '[:space:]' < "${ROOT}/logs/port")"
      if [ -n "$port" ]; then
        body="$(curl -fsS --max-time 1 "http://127.0.0.1:${port}/api/status" 2>/dev/null || true)"
        if [ -z "$body" ]; then
          body="$(curl -fsS --max-time 1 "http://localhost:${port}/api/status" 2>/dev/null || true)"
        fi
        case "$body" in
          *'"booksRoot"'*)
            echo "$port"
            return 0
            ;;
        esac
      fi
    fi
    sleep 0.5
  done
  return 1
}

cmd_run() {
  prepare_runtime
  cd "$ROOT"
  echo "$(date '+%Y-%m-%d %H:%M:%S') 启动，node=${NODE_RESOLVED}"
  exec "$NODE_RESOLVED" "${ROOT}/Src/server.js" --port=3000
  echo "[Error] 无法启动阅读器进程。" >&2
  exit 1
}

cmd_start() {
  prepare_runtime
  warn_existing_reader
  install_agent "$NODE_RESOLVED"
  local port
  if ! port="$(wait_for_port)"; then
    echo "[Error] 阅读器未能在限定时间内启动。" >&2
    echo "日志：${LOG_DIR}/service.err.log" >&2
    if [ -f "${LOG_DIR}/service.err.log" ]; then
      echo "---------- 最近的错误日志 ----------" >&2
      tail -n 40 "${LOG_DIR}/service.err.log" >&2 || true
    fi
    if [ -f "${LOG_DIR}/service.log" ]; then
      echo "---------- 最近的运行日志 ----------" >&2
      tail -n 20 "${LOG_DIR}/service.log" >&2 || true
    fi
    return 1
  fi
  open "http://127.0.0.1:${port}/" || echo "[注意] 服务已启动，但未能自动打开浏览器。"
  echo ""
  echo "阅读器已在后台运行：http://127.0.0.1:${port}/"
  echo "关闭本窗口不会停止服务。"
  echo "登录后会自动启动；进程退出后会自动重新拉起。"
  echo "停止到下次登录：双击 stop.command"
  echo "取消登录自启：./service.sh uninstall"
  echo "日志：${LOG_DIR}/"
}

cmd_stop() {
  if is_loaded; then
    launchctl bootout "$TARGET" >/dev/null 2>&1 || launchctl bootout "$DOMAIN" "$PLIST"
    echo "已停止阅读器。下次登录或重启电脑后会自动再启动。"
    echo "若要取消登录自启，请运行 ./service.sh uninstall"
    return 0
  fi
  echo "阅读器服务当前没有在运行。"
}

cmd_uninstall() {
  if [ ! -f "$PLIST" ] && ! is_loaded; then
    echo "没有已安装的自启服务。"
    return 0
  fi
  if is_loaded; then
    launchctl bootout "$TARGET" >/dev/null 2>&1 || launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
  fi
  launchctl disable "$TARGET" >/dev/null 2>&1 || true
  rm -f "$PLIST" "$RUNNER"
  echo "已取消登录自启，并停止阅读器。"
  echo "需要时再双击 start.command。"
}

cmd_status() {
  local state pid port
  if [ ! -f "$PLIST" ] && ! is_loaded; then
    echo "未安装自启服务。"
    return 1
  fi
  echo "配置：${PLIST}"
  if ! is_loaded; then
    echo "状态：未加载（下次登录会自动加载）"
    return 0
  fi
  state="$(service_state || true)"
  echo "状态：${state:-未知}"
  pid="$(service_pid || true)"
  if [ -n "$pid" ]; then
    echo "进程：${pid}"
  fi
  if [ -f "${ROOT}/logs/port" ]; then
    port="$(tr -d '[:space:]' < "${ROOT}/logs/port")"
    echo "地址：http://127.0.0.1:${port}/"
  fi
  echo "日志：${LOG_DIR}/service.log"
}

main() {
  local cmd="${1:-start}"
  case "$cmd" in
    run) cmd_run ;;
    start) cmd_start ;;
    stop) cmd_stop ;;
    uninstall) cmd_uninstall ;;
    status) cmd_status ;;
    -h|--help|help) usage ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
