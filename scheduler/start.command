#!/bin/zsh
# Double-click to start the Content Scheduler (http://localhost:8787)
cd "$(dirname "$0")"
python3 server.py
