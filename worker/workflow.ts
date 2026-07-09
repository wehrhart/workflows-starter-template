import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";
import { extractBillSheet } from "./lib/extract";
import { processBillSheets } from "./lib/transform";
import { PIPELINE_STEPS } from "./durable-object";
import type { BillSheet } from "./lib/types";

export interface BillSheetParams extends Record<string, unknown> {
	batchId: string;
	files: Array<{ key: string; name: string }>;
}

/**
 * BillSheetWorkflow — durable pipeline that reads uploaded Kaiser/Abyrx bill
 * sheet PDFs and appends their rows to the running master sheet.
 *
 *   1. read bill sheets   — read each PDF into structured fields (offline)
 *   2. resolve & map        — resolve Surgery Location, combine products, route
 *                             missing-Case-ID sheets
 *   3. add to master sheet  — append the rows to the ledger (LedgerDO)
 */
export class BillSheetWorkflow extends WorkflowEntrypoint<Env, BillSheetParams> {
	async run(event: WorkflowEvent<BillSheetParams>, step: WorkflowStep) {
		const { batchId, files } = event.payload;

		const notify = async (
			stepName: string,
			status: "running" | "completed" | "waiting",
		) => {
			try {
				const stub = this.env.WORKFLOW_STATUS.get(
					this.env.WORKFLOW_STATUS.idFromName(batchId),
				);
				await stub.updateStep(stepName, status);
			} catch {
				// status is best-effort
			}
		};
		const fail = async (message: string) => {
			try {
				const stub = this.env.WORKFLOW_STATUS.get(
					this.env.WORKFLOW_STATUS.idFromName(batchId),
				);
				await stub.setError(message);
			} catch {
				// ignore
			}
		};

		try {
			// Step 1: read every PDF (deterministic, no cloud AI).
			await notify(PIPELINE_STEPS[0], "running");
			const sheets = await step.do(PIPELINE_STEPS[0], async () => {
				const out: BillSheet[] = [];
				for (const f of files) {
					const obj = await this.env.BILL_SHEETS.get(f.key);
					if (!obj) throw new Error(`upload not found: ${f.name}`);
					const bytes = new Uint8Array(await obj.arrayBuffer());
					out.push(await extractBillSheet(f.name, bytes));
				}
				return out;
			});
			await notify(PIPELINE_STEPS[0], "completed");

			// Step 2: resolve locations, combine products, split missing-Case-ID.
			// Skip any sheet whose Case ID is already in the master (one entry per
			// Case ID) so a re-submitted bill sheet can't duplicate its rows.
			await notify(PIPELINE_STEPS[1], "running");
			const result = await step.do(PIPELINE_STEPS[1], async () => {
				const ledger = this.env.LEDGER.get(
					this.env.LEDGER.idFromName("default"),
				);
				const snap = await ledger.snapshot();
				const knownCaseIds = snap.uploadRows
					.map((r) => r.B)
					.filter((b): b is string => !!b);
				return processBillSheets(sheets, knownCaseIds);
			});
			await notify(PIPELINE_STEPS[1], "completed");

			// Step 3: append this batch's rows to the running master sheet.
			await notify(PIPELINE_STEPS[2], "running");
			const summary = await step.do(PIPELINE_STEPS[2], async () => {
				const stub = this.env.LEDGER.get(
					this.env.LEDGER.idFromName("default"),
				);
				const state = await stub.append({
					uploadRows: result.uploadRows,
					missingRows: result.missingRows,
					// Skipped duplicates added no rows — keep them out of the master's
					// file list so its sheet count stays accurate.
					files: result.files.filter((f) => f.routed !== "duplicate"),
				});
				return {
					addedRows: result.uploadRows.length,
					addedMissing: result.missingRows.length,
					totalRows: state.uploadRows.length,
					totalMissing: state.missingRows.length,
					files: result.files,
				};
			});
			await notify(PIPELINE_STEPS[2], "completed");

			const stub = this.env.WORKFLOW_STATUS.get(
				this.env.WORKFLOW_STATUS.idFromName(batchId),
			);
			await stub.setResult(summary);
		} catch (err) {
			await fail(err instanceof Error ? err.message : "Processing failed");
			throw err;
		}
	}
}
