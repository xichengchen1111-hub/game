#!/bin/sh
set -eu
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  NODE_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ ! -x "$NODE_BIN" ]; then
  echo "需要 Node.js 20.19+ 或 22.12+。安装后运行 npm install 和 npm run dev。"
  exit 1
fi
if [ ! -f node_modules/vite/bin/vite.js ]; then
  echo "请先运行 npm install 安装依赖。"
  exit 1
fi
exec "$NODE_BIN" node_modules/vite/bin/vite.js --host 127.0.0.1 "$@"
