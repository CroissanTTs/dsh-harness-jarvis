#!/bin/sh
# Release-build the panel and place the binary where the host plugin spawns it.
set -e
cd "$(dirname "$0")"
swift build -c release --product jarvis-panel
# Replace, never overwrite in place: the kernel caches a binary's code
# signature per file, so rewriting a file that has run gets later launches
# SIGKILLed with "Code Signature Invalid".
cp .build/release/jarvis-panel ./jarvis-panel.new
mv -f ./jarvis-panel.new ./jarvis-panel
echo "built $(pwd)/jarvis-panel"
