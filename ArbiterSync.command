#!/bin/bash
cd "$(dirname "$0")"

# Find Node.js in common Mac locations
NODE=""
for p in /usr/local/bin/node /opt/homebrew/bin/node /opt/homebrew/opt/node/bin/node; do
  if [ -f "$p" ]; then
    NODE="$p"
    break
  fi
done

# Also try PATH
if [ -z "$NODE" ]; then
  NODE=$(which node 2>/dev/null)
fi

if [ -z "$NODE" ]; then
  osascript -e 'display alert "Node.js not found" message "Please install Node.js from https://nodejs.org (LTS version), then try again."'
  exit 1
fi

# If server is already running, just open the browser
if curl -s http://localhost:3000 > /dev/null 2>&1; then
  open http://localhost:3000
  exit 0
fi

# Start the server in the background
"$NODE" server.js &

# Wait for it to start, then open browser
sleep 2.5
open http://localhost:3000

# Keep terminal open so server keeps running
wait
