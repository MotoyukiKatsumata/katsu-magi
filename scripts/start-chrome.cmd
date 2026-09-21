@echo off
REM Starts the user's installed Chrome with remote debugging on port 9222 using the
REM katsu-magi profile. Use together with "browser.mode": "connect" in katsu-magi.config.json.
set PROFILE=%LOCALAPPDATA%\katsu-magi\chrome-profile
if not exist "%PROFILE%" mkdir "%PROFILE%"
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check
