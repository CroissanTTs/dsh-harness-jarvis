#!/bin/sh
# Release-build the panel and place the binary where the host plugin spawns it.
set -e
cd "$(dirname "$0")"
swift build -c release --product jarvis-panel
cp .build/release/jarvis-panel ./jarvis-panel
echo "built $(pwd)/jarvis-panel"
