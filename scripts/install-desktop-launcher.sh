#!/bin/bash
# Copy PitWall XR launcher to ~/Desktop for double-click startup.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/scripts/start-pitwall.command"
TARGET="$HOME/Desktop/Start PitWall XR.command"

if [ ! -f "$SOURCE" ]; then
  echo "Missing launcher: $SOURCE"
  exit 1
fi

chmod +x "$SOURCE"
cp "$SOURCE" "$TARGET"
chmod +x "$TARGET"

echo "Installed Desktop launcher:"
echo "  $TARGET"
echo ""
echo "Double-click \"Start PitWall XR\" on your Desktop to launch."
echo "Electron opens → sign in via F1 TV → then use https://localhost:5173 in any browser."
