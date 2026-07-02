#!/bin/bash
# PitWall XR — double-click launcher (also installable to ~/Desktop via install-desktop-launcher.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

alert() {
  osascript -e "display alert \"PitWall XR\" message \"$1\" as warning" 2>/dev/null || echo "PitWall XR: $1"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PitWall XR"
echo "  Starting from: $ROOT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if ! command -v node >/dev/null 2>&1; then
  alert "Node.js is not installed.

Install Node 20+ from https://nodejs.org
Then run: npm install -g pnpm"
  read -r -p "Press Enter to close…"
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
  alert "Node.js 20 or newer is required (found $(node -v)).

Upgrade from https://nodejs.org"
  read -r -p "Press Enter to close…"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found — installing globally…"
  if ! npm install -g pnpm; then
    alert "Could not install pnpm.

Run in Terminal:
  npm install -g pnpm"
    read -r -p "Press Enter to close…"
    exit 1
  fi
fi

if [ ! -d "node_modules" ]; then
  echo "First run — installing dependencies (this may take a minute)…"
  if ! pnpm install; then
    alert "pnpm install failed.

Open Terminal in:
  $ROOT

Then run:
  pnpm install"
    read -r -p "Press Enter to close…"
    exit 1
  fi
fi

echo ""
echo "Launching server, web UI, and Electron…"
echo "When the app opens: Open F1 TV → sign in → Continue to Pit Wall"
echo ""
echo "Browser UI (after sign-in): https://localhost:5173"
echo ""

if ! pnpm dev; then
  alert "PitWall XR stopped with an error.

Check the Terminal window for details, or run:
  cd \"$ROOT\" && pnpm dev"
  read -r -p "Press Enter to close…"
  exit 1
fi
