#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null; then
  echo 'Install Node.js 22.13 or newer, then run this file again.'
  read -r -p 'Press Enter to close. '
  exit 1
fi
if [ ! -d node_modules/7zip-bin ]; then npm ci --omit=dev --no-audit --no-fund || exit 1; fi
node src/launch.mjs
