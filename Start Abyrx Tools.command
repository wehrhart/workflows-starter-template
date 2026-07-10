#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Double-click me (Mac) to start Abyrx Tools — no terminal typing needed.
#
# Starts the Kairuku session service and the app, then opens the app in your
# browser at http://localhost:5280. Keep the window that appears open while
# you use the tools; close it to stop everything.
#
# First run may take a few minutes: it installs the app's packages and the
# Chromium browser the Kairuku login window uses. After that, starts are fast.
# ─────────────────────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
	echo "First-time setup: installing packages (a few minutes)…"
	npm install
	npx playwright install chromium
fi

echo "Starting the Kairuku session service…"
npm run kairuku:session &
KAIRUKU_PID=$!
trap 'kill $KAIRUKU_PID 2>/dev/null' EXIT

# Open the app in the default browser once the dev server has had a moment.
( sleep 4; command -v open >/dev/null && open "http://localhost:5280" ) &

echo "Starting Abyrx Tools at http://localhost:5280 — leave this window open."
npm run dev
