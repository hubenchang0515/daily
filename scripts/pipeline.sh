#!/usr/bin/bash

set -e

SCRIPT_DIR="$(dirname $(readlink -f $0))"
PROJECT_DIR="$(dirname -- "$SCRIPT_DIR")"

source $HOME/.nvm/nvm.sh
export PATH=$HOME/.opencode/bin:$PATH

cd $PROJECT_DIR
npm run gen -- "$1" -m "$2"
npm run build
npm run commit
npm run deploy
