@echo off
schtasks /create /tn "ArbiterSync" /tr "cmd /c cd /d C:\Users\jwohl\arbiter-sync ^&^& node scripts\sync.js >> C:\Users\jwohl\arbiter-sync\data\sync.log 2>&1" /sc daily /st 09:00 /f
echo.
echo Done. Task scheduled for 9:00 AM daily.
pause
