import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";
import { extractBillSheet } from "./lib/extract";
import { processBillSheets } from "./lib/transform";
import { buildFilledWorkbook } from "./lib/xlsx-inject";
import { getTemplateBytes } from "./lib/template";
import { PIPELINE_STEPS } from "./durable-object";
import type { BillSheet } from "./lib/types";

export interface BillSheetParams extends Record<string, unknown> {
	batchId: string;
	files: Array<{ key: string; name: string }>;
	outputName: string;
}

const OUTPUT_KEY = (batchId: string) => `${batchId}/output.xlsm`;

/**
 * BillSheetWorkflow — durable pipeline that turns uploaded Kaiser/Abyrx bill
 * sheet PDFs into a filled copy of the Bill-Only .xlsm upload template.
 *
 *   1. read bill sheets  — Workers AI reads each PDF into structured fields
 *   2. resolve & map      — resolve Surgery Location, combine products, route
 *                           missing-Case-ID sheets
 *   3. build spreadsheet  — inject rows into the template, store in R2
 */
export class BillSheetWorkflow extends WorkflowEntrypoint<Env, BillSheetParams> {
	async run(event: WorkflowEvent<BillSheetParams>, step: WorkflowStep) {
		const { batchId, files, outputName } = event.payload;

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
			await notify(PIPELINE_STEPS[1], "running");
			const result = await step.do(PIPELINE_STEPS[1], async () =>
				processBillSheets(sheets),
			);
			await notify(PIPELINE_STEPS[1], "completed");

			// Step 3: inject rows into the template and store the workbook.
			await notify(PIPELINE_STEPS[2], "running");
			const summary = await step.do(PIPELINE_STEPS[2], async () => {
				const bytes = buildFilledWorkbook(
					getTemplateBytes(),
					result.uploadRows,
					result.missingRows,
				);
				await this.env.BILL_SHEETS.put(OUTPUT_KEY(batchId), bytes, {
					httpMetadata: {
						contentType:
							"application/vnd.ms-excel.sheet.macroEnabled.12",
						contentDisposition: `attachment; filename="${outputName}"`,
					},
				});
				return {
					downloadReady: true,
					fileName: outputName,
					uploadRows: result.uploadRows.length,
					missingRows: result.missingRows.length,
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
