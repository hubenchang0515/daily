#!/usr/bin/bash

# 出错时退出，不继续执行
set -e

# 失败重试：最多 3 次，指数退避（5s → 10s）
retry() {
  local max_attempts=3
  local delay=5
  local attempt=1
  while true; do
    if "$@"; then
      return 0
    fi
    if (( attempt >= max_attempts )); then
      echo "[retry] 已重试 $((max_attempts - 1)) 次仍失败，放弃: $*"
      return 1
    fi
    echo "[retry] 第 $attempt/$max_attempts 次失败: $*，${delay}s 后重试"
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

# 重定向到日志
exec > >(tee -a /tmp/daily.log) 2>&1

SCRIPT_DIR="$(dirname $(readlink -f $0))"
PROJECT_DIR="$(dirname -- "$SCRIPT_DIR")"

source $HOME/.nvm/nvm.sh
export PATH=$HOME/.opencode/bin:$PATH

cd $PROJECT_DIR

retry git pull --rebase --autostash
retry npm run gen -- "$1" -m "$2"
retry npm run build
git add daily-document 
git commit -a -m '自动提交' 
retry git push origin master
retry npm run deploy