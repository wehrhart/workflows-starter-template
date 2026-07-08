// Export the Workflow and Durable Object classes
export { BillSheetWorkflow } from "./workflow";
export { WorkflowStatusDO } from "./durable-object";
export { LedgerDO } from "./ledger-do";

import type { BillSheetParams } from "./workflow";
import { buildFilledWorkbook } from "./lib/xlsx-inject";
import { getTemplateBytes } from "./lib/template";
import type { MissingRow } from "./lib/types";

const MAX_FILES = 25;
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per PDF
const MASTER_FILENAME = "Abyrx_Bill_Only_Upload.xlsm";

function ledger(env: Env) {
	return env.LEDGER.get(env.LEDGER.idFromName("default"));
}

/**
 * Main Worker fetch handler.
 *
 * - POST /api/bill-sheets       -> upload PDF bill sheets, start a batch
 * - GET  /api/ledger            -> current master-sheet summary (counts + files)
 * - GET  /api/ledger/download   -> download the master .xlsm (all accumulated rows)
 * - POST /api/ledger/clear      -> wipe the master sheet (after uploading to Kaiser)
 * - GET  /ws?instanceId=:id     -> WebSocket for live pipeline status
 */
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// Start a batch: multipart upload of one or more PDF bill sheets.
		if (url.pathname === "/api/bill-sheets" && request.method === "POST") {
			try {
				const form = await request.formData();
				const uploads = form
					.getAll("files")
					.filter((f): f is File => f instanceof File && f.size > 0);

				if (uploads.length === 0) {
					return Response.json({ error: "No PDF files provided" }, { status: 400 });
				}
				if (uploads.length > MAX_FILES) {
					return Response.json(
						{ error: `Too many files (max ${MAX_FILES})` },
						{ status: 400 },
					);
				}
				for (const f of uploads) {
					if (f.size > MAX_BYTES) {
						return Response.json({ error: `${f.name} exceeds 15 MB` }, { status: 400 });
					}
				}

				const batchId = crypto.randomUUID();
				const files: BillSheetParams["files"] = [];
				for (let i = 0; i < uploads.length; i++) {
					const f = uploads[i];
					const key = `${batchId}/in/${i}-${sanitize(f.name)}`;
					await env.BILL_SHEETS.put(key, await f.arrayBuffer(), {
						httpMetadata: { contentType: "application/pdf" },
					});
					files.push({ key, name: f.name });
				}

				await env.BILL_SHEET_WORKFLOW.create({
					id: batchId,
					params: { batchId, files },
				});

				return Response.json({
					instanceId: batchId,
					fileCount: files.length,
					message: "Batch started",
				});
			} catch (err) {
				return Response.json(
					{
						error: "Failed to start batch",
						detail: err instanceof Error ? err.message : String(err),
					},
					{ status: 500 },
				);
			}
		}

		// Master-sheet summary.
		if (url.pathname === "/api/ledger" && request.method === "GET") {
			const snap = await ledger(env).snapshot();
			return Response.json({
				totalRows: snap.uploadRows.length,
				totalMissing: snap.missingRows.length,
				files: snap.files,
				updatedAt: snap.updatedAt,
			});
		}

		// Download the master .xlsm (all accumulated rows).
		if (url.pathname === "/api/ledger/download" && request.method === "GET") {
			const snap = await ledger(env).snapshot();
			const bytes = buildFilledWorkbook(
				getTemplateBytes(),
				snap.uploadRows,
				snap.missingRows as MissingRow[],
			);
			return new Response(bytes, {
				headers: {
					"Content-Type": "application/vnd.ms-excel.sheet.macroEnabled.12",
					"Content-Disposition": `attachment; filename="${MASTER_FILENAME}"`,
				},
			});
		}

		// Clear the master sheet.
		if (url.pathname === "/api/ledger/clear" && request.method === "POST") {
			await ledger(env).clear();
			return Response.json({ success: true });
		}

		// WebSocket for live status.
		if (url.pathname === "/ws") {
			const instanceId = url.searchParams.get("instanceId");
			if (!instanceId) {
				return new Response("instanceId query parameter required", { status: 400 });
			}
			if (request.headers.get("Upgrade") !== "websocket") {
				return new Response("Expected Upgrade: websocket", { status: 426 });
			}
			try {
				const stub = env.WORKFLOW_STATUS.get(
					env.WORKFLOW_STATUS.idFromName(instanceId),
				);
				return stub.fetch(request);
			} catch {
				return new Response("Failed to establish WebSocket connection", {
					status: 500,
				});
			}
		}

		// Everything else (the SPA and its assets) is served by the static-asset
		// layer. We run the Worker first (run_worker_first) so /api and /ws above
		// win; non-API requests fall through to the assets here.
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;

function sanitize(name: string): string {
	return name.replace(/[^\w.-]+/g, "_").slice(0, 80);
}
