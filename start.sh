#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24 or newer from https://nodejs.org/ and run this file again.'
  exit 1
fi
node -e 'if(Number(process.versions.node.split(".")[0])<24){console.error("Node.js 24 or newer is required.");process.exit(1)}'
if [ ! -f node_modules/express/package.json ]; then
  npm ci --omit=dev --no-audit --no-fund --cache "${TMPDIR:-/tmp}/dideban-npm-cache"
fi
exec node --env-file-if-exists=.env launch.mjs
