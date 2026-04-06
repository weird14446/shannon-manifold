#!/bin/sh
set -eu

cd /app

if [ ! -f /app/node_modules/express/package.json ] || [ ! -f /app/node_modules/iconv-lite/encodings/index.js ]; then
  echo "Lean server dependencies missing or incomplete. Running npm ci..."
  npm ci
fi

exec npm start
