#!/usr/bin/bash

# 出错时退出，不继续执行
set -e

# 重定向到日志
exec > >(tee -a /tmp/daily.log) 2>&1

SCRIPT_DIR="$(dirname $(readlink -f $0))"
PROJECT_DIR="$(dirname -- "$SCRIPT_DIR")"

source $HOME/.nvm/nvm.sh
export PATH=$HOME/.opencode/bin:$PATH

cd $PROJECT_DIR
npm run gen -- "$1" -m "$2"
npm run build
npm run commit
npm run deploy
