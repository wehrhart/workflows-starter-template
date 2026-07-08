// Export the Workflow and Durable Object classes
export { BillSheetWorkflow } from "./workflow";
export { WorkflowStatusDO } from "./durable-object";

import type { BillSheetParams } from "./workflow";

const MAX_FILES = 25;
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per PDF

function outputName(): string {
	return "Abyrx_Bill_Only_Upload.xlsm";
}

/**
 * Main Worker fetch handler.
 *
 * - POST /api/bill-sheets            -> upload PDF bill sheets, start a batch
 * - GET  /api/bill-sheets/:id/download -> download the filled .xlsm
 * - GET  /ws?instanceId=:id          -> WebSocket for live pipeline status
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
						return Response.json(
							{ error: `${f.name} exceeds 15 MB` },
							{ status: 400 },
						);
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
					params: { batchId, files, outputName: outputName() },
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

		// Download the filled workbook for a batch.
		const dl = url.pathname.match(/^\/api\/bill-sheets\/([^/]+)\/download$/);
		if (dl && request.method === "GET") {
			const batchId = dl[1];
			const obj = await env.BILL_SHEETS.get(`${batchId}/output.xlsm`);
			if (!obj) {
				return Response.json({ error: "Not ready" }, { status: 404 });
			}
			const headers = new Headers();
			obj.writeHttpMetadata(headers);
			headers.set(
				"Content-Type",
				"application/vnd.ms-excel.sheet.macroEnabled.12",
			);
			if (!headers.has("Content-Disposition")) {
				headers.set(
					"Content-Disposition",
					`attachment; filename="${outputName()}"`,
				);
			}
			return new Response(obj.body, { headers });
		}

		// WebSocket for live status.
		if (url.pathname === "/ws") {
			const instanceId = url.searchParams.get("instanceId");
			if (!instanceId) {
				return new Response("instanceId query parameter required", {
					status: 400,
				});
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

		return Response.json({ error: "Not Found" }, { status: 404 });
	},
} satisfies ExportedHandler<Env>;

function sanitize(name: string): string {
	return name.replace(/[^\w.-]+/g, "_").slice(0, 80);
}
