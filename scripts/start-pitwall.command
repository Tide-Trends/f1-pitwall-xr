#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
echo "Starting PitWall XR from $(pwd)…"
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found. Install Node 20+ and run: npm install -g pnpm"
  read -r -p "Press Enter to close…"
  exit 1
fi
pnpm dev
