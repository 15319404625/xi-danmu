#!/bin/bash
cd "$(dirname "$0")"
while true; do node server.js; echo "restarting..."; sleep 2; done
