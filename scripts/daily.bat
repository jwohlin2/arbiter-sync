@echo off
cd /d C:\Users\jwohl\arbiter-sync
"C:\Program Files\nodejs\node.exe" scripts\sync.js >> data\sync.log 2>&1
"C:\Program Files\nodejs\node.exe" scripts\send-confirmations.js >> data\sync.log 2>&1
