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

if ! command -v npm >/dev/null 2>&1; then
	echo ""
	echo "Node.js isn't installed yet (it powers these tools)."
	echo "1. Go to https://nodejs.org and click the big green LTS download button."
	echo "2. Open the downloaded installer and click through it (all defaults are fine)."
	echo "3. Double-click 'Start Abyrx Tools' again."
	echo ""
	read -n 1 -s -r -p "Press any key to close this window…"
	exit 1
fi

# Setup is only considered done when the marker file exists — a half-finished
# install (e.g. wifi dropped mid-download) is retried in full next time.
if [ ! -f .abyrx-setup-complete ]; then
	echo "First-time setup: installing packages (a few minutes)…"
	setup_ok=0
	for attempt in 1 2 3; do
		if npm install && npx playwright install chromium; then
			setup_ok=1
			break
		fi
		echo ""
		echo "The download hiccupped (attempt $attempt of 3) — retrying in 10 seconds…"
		sleep 10
	done
	if [ "$setup_ok" != 1 ]; then
		echo ""
		echo "Setup couldn't finish. This is almost always a network hiccup:"
		echo "check your wifi, turn off any VPN, then double-click 'Start Abyrx Tools' again."
		read -n 1 -s -r -p "Press any key to close this window…"
		exit 1
	fi
	touch .abyrx-setup-complete
fi

# Stop any older copies still running from a previous folder or session — a
# stale background service holding port 5281 would keep serving OLD behavior
# to a NEW app, which is impossible to debug from the outside.
for port in 5280 5281; do
	lsof -ti tcp:$port 2>/dev/null | xargs kill 2>/dev/null || true
done
sleep 1

echo "Starting the Kairuku session service…"
npm run kairuku:session &
KAIRUKU_PID=$!
trap 'kill $KAIRUKU_PID 2>/dev/null' EXIT

# Open the app in the default browser once the dev server has had a moment.
( sleep 4; command -v open >/dev/null && open "http://localhost:5280" ) &

echo "Starting Abyrx Tools at http://localhost:5280 — leave this window open."
npm run dev
