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
 * Endpoints (all JSON unless noted):
 *   GET  /api/kairuku/status              → current status (no side effects)
 *   POST /api/kairuku/open-login          → open the headed login window
 *   POST /api/kairuku/check               → verify the saved session headlessly
 *   POST /api/kairuku/close               → close any open Kairuku browser window
 *   POST /api/kairuku/demo-units/extract  → { imageBase64 } → OCR'd sheet fields
 *   POST /api/kairuku/demo-units/run      → start a Demo Units run
 *   GET  /api/kairuku/demo-units/run      → current/last run progress
 *   GET  /api/kairuku/overage             → Overage reps rows
 *   GET  /api/kairuku/overage.xlsx        → the sheet as a downloadable Excel file
 */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	checkKairukuSessionStatus,
	closeKairukuBrowser,
	getKairukuStatus,
	openKairukuLoginWindow,
	KAIRUKU_URL,
} from "./kairukuSessionManager.ts";
import { getDemoUnitsRun, startDemoUnitsRun } from "./demoUnitsRunner.ts";
import type { DemoUnitsInput } from "./demoUnitsRunner.ts";
import { extractShippingSheet } from "./extractShippingSheet.ts";
import { buildOverageXlsx, getOverageRows } from "./overageSheet.ts";
import { APP_VERSION } from "../../src/version.ts";

/** Status responses carry the service's build version so the app can detect
 * a stale service process left over from an older folder. */
const versioned = <T extends object>(r: T) => ({ ...r, version: APP_VERSION });

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

/** Read a JSON request body (photos arrive base64-encoded, so allow ~30 MB). */
function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > 30 * 1024 * 1024) {
				reject(new Error("Request too large (max 30 MB)"));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
			} catch {
				reject(new Error("Body isn't valid JSON"));
			}
		});
		req.on("error", reject);
	});
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
	const route = `${req.method} ${url.pathname}`;

	if (req.method === "OPTIONS") return sendJson(res, 204, {});

	try {
		switch (route) {
			case "GET /api/kairuku/status":
				return sendJson(res, 200, versioned(getKairukuStatus()));
			case "POST /api/kairuku/open-login":
				return sendJson(res, 200, versioned(await openKairukuLoginWindow()));
			case "POST /api/kairuku/check":
				return sendJson(res, 200, versioned(await checkKairukuSessionStatus()));
			case "POST /api/kairuku/close":
				return sendJson(res, 200, versioned(await closeKairukuBrowser()));

			case "POST /api/kairuku/demo-units/extract": {
				const body = await readJson(req);
				const b64 = String(body.imageBase64 ?? "").replace(/^data:[^,]+,/, "");
				if (!b64) return sendJson(res, 400, { error: "imageBase64 is required" });
				const result = await extractShippingSheet(Buffer.from(b64, "base64"));
				return sendJson(res, 200, result);
			}
			case "POST /api/kairuku/demo-units/run": {
				const body = await readJson(req);
				return sendJson(res, 200, await startDemoUnitsRun(body as unknown as DemoUnitsInput));
			}
			case "GET /api/kairuku/demo-units/run":
				return sendJson(res, 200, getDemoUnitsRun() ?? { state: "none" });

			case "GET /api/kairuku/overage":
				return sendJson(res, 200, { rows: getOverageRows() });
			case "GET /api/kairuku/overage.xlsx": {
				const bytes = buildOverageXlsx();
				res.writeHead(200, {
					"content-type":
						"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
					"content-disposition": 'attachment; filename="Overage reps.xlsx"',
					"access-control-allow-origin": "*",
				});
				return res.end(Buffer.from(bytes));
			}

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
