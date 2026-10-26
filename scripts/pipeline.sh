#!/usr/bin/bash

set -e

SCRIPT_DIR="$(dirname $(readlink -f $0))"
PROJECT_DIR="$(dirname -- "$SCRIPT_DIR")"

source $HOME/.nvm/nvm.sh

cd $PROJECT_DIR
npm run gen -- "$1" -m "$2"
npm run commit
npm run deploy