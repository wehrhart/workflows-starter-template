/**
 * Kairuku Session Service — a tiny local HTTP wrapper around
 * kairukuSessionManager.ts so the Abyrx Tools web UI (and future tools) can
 * drive the login/session flow.
 *
 * Playwright needs a real OS process to open a browser window, which a web
 * page / Cloudflare worker can't do — so this runs as a local Node sidecar:
 *
 *   npm run kairuku:session          # serves http://127.0.0.1:5281
 *
 * It binds to 127.0.0.1 only (never exposed to the network) and its JSON
 * responses contain only status strings — never cookies, tokens, or
 * credentials.
 *
 * Endpoints (all JSON):
 *   GET  /api/kairuku/status      → current status (no side effects)
 *   POST /api/kairuku/open-login  → open the headed login window
 *   POST /api/kairuku/check       → verify the saved session headlessly
 *   POST /api/kairuku/close       → close any open Kairuku browser window
 */

import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import {
	checkKairukuSessionStatus,
	closeKairukuBrowser,
	getKairukuStatus,
	openKairukuLoginWindow,
	KAIRUKU_URL,
} from "./kairukuSessionManager.ts";

const PORT = Number(process.env.KAIRUKU_SESSION_PORT ?? 5281);
const HOST = "127.0.0.1";

function sendJson(res: ServerResponse, code: number, body: unknown) {
	res.writeHead(code, {
		"content-type": "application/json",
		// The service only ever runs on the user's own machine and returns
		// nothing sensitive, so a permissive CORS header keeps the Vite dev
		// app (any local port) able to reach it.
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "content-type",
	});
	res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
	const route = `${req.method} ${url.pathname}`;

	if (req.method === "OPTIONS") return sendJson(res, 204, {});

	try {
		switch (route) {
			case "GET /api/kairuku/status":
				return sendJson(res, 200, getKairukuStatus());
			case "POST /api/kairuku/open-login":
				return sendJson(res, 200, await openKairukuLoginWindow());
			case "POST /api/kairuku/check":
				return sendJson(res, 200, await checkKairukuSessionStatus());
			case "POST /api/kairuku/close":
				return sendJson(res, 200, await closeKairukuBrowser());
			default:
				return sendJson(res, 404, { error: "not found" });
		}
	} catch (err) {
		// Error messages from the manager are status-level only (no secrets).
		const message = err instanceof Error ? err.message : "unknown error";
		return sendJson(res, 500, { error: message, ...getKairukuStatus() });
	}
});

server.listen(PORT, HOST, () => {
	console.log(`[kairuku] session service on http://${HOST}:${PORT}`);
	console.log(`[kairuku] login URL: ${KAIRUKU_URL}`);
});

async function shutdown() {
	await closeKairukuBrowser().catch(() => {});
	server.close(() => process.exit(0));
	// Failsafe if a socket lingers.
	setTimeout(() => process.exit(0), 2_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
