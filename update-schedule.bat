@echo off
schtasks /create /tn "ArbiterSync" /tr "C:\Users\jwohl\arbiter-sync\scripts\daily.bat" /sc daily /st 09:00 /f
echo.
echo Updated. ArbiterSync task now runs sync + email confirmations at 9:00 AM daily.
pause
