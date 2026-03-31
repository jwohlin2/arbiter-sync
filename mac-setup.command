#!/bin/bash
cd "$(dirname "$0")"

echo "=== Arbiter Sync — Mac Setup ==="
echo ""

# Find Node
NODE=""
for p in /usr/local/bin/node /opt/homebrew/bin/node /opt/homebrew/opt/node/bin/node; do
  if [ -f "$p" ]; then NODE="$p"; break; fi
done
if [ -z "$NODE" ]; then NODE=$(which node 2>/dev/null); fi

if [ -z "$NODE" ]; then
  echo "ERROR: Node.js not found."
  echo "Install it from https://nodejs.org (LTS version), then run this again."
  read -p "Press Enter to close..."
  exit 1
fi

NPM=$(dirname "$NODE")/npm

echo "Node found at: $NODE"
echo ""

# Make launcher executable
chmod +x ArbiterSync.command
echo "✓ Launcher ready"

# Install dependencies
echo "Installing dependencies..."
"$NPM" install
echo "✓ Dependencies installed"

# Install Chromium
echo "Installing Chromium (this may take a minute)..."
"$(dirname "$NODE")/npx" playwright install chromium
echo "✓ Chromium installed"

echo ""
echo "=== Setup complete! ==="
echo "Double-click ArbiterSync.command to launch the app."
echo ""
read -p "Press Enter to close..."
