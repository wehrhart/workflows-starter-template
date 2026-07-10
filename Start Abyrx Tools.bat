@echo off
rem ───────────────────────────────────────────────────────────────────────────
rem Double-click me (Windows) to start Abyrx Tools — no terminal typing needed.
rem
rem Starts the Kairuku session service and the app, then opens the app in your
rem browser at http://localhost:5280. Keep this window open while you use the
rem tools; close it to stop.
rem
rem First run may take a few minutes: it installs the app's packages and the
rem Chromium browser the Kairuku login window uses. After that, starts are fast.
rem ───────────────────────────────────────────────────────────────────────────
cd /d "%~dp0"

if not exist node_modules (
	echo First-time setup: installing packages, this can take a few minutes...
	call npm install
	call npx playwright install chromium
)

echo Starting the Kairuku session service...
start "Kairuku Session Service" cmd /c "npm run kairuku:session"

start "" "http://localhost:5280"

echo Starting Abyrx Tools at http://localhost:5280 — leave this window open.
call npm run dev
