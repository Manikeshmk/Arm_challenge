@echo off
echo =======================================================
echo Local Smartphone Arm CPU S2S Tester
echo =======================================================
echo.
echo Requirements before continuing:
echo 1. Connect Moto Edge to your PC via USB.
echo 2. Enable Developer Options -^> USB Debugging on Phone.
echo 3. Allow pop-up prompts on phone for USB Debugging.
echo.
pause

echo Setting up ADB Reverse Port Forwarding...
adb reverse tcp:8000 tcp:8000
if %errorlevel% neq 0 (
    echo [WARNING] ADB not found or device not connected properly!
    echo If the port-forward fails, you won't be able to open localhost:8000 on your phone.
    pause
) else (
    echo [SUCCESS] Port Forwarded successfully!
)

echo.
echo =======================================================
echo [INSTRUCTION]: Open your phone's internet browser (Chrome)
echo [INSTRUCTION]: Navigate exactly to:   http://localhost:8000
echo =======================================================
echo.
echo Starting Python Web Server... Keep this window open!
python -m http.server 8000
pause
