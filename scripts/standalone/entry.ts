/**
 * Browser entry for the standalone (hosted-link) build of Abyrx Tools.
 *
 * It re-exports the SAME extract / transform / spreadsheet-injection logic the
 * Cloudflare Worker uses, so the hosted page runs the exact tested code — PDF
 * text is read with unpdf on the main thread (no web worker, sandbox-friendly),
 * and the .xlsm is built from the embedded template with fflate. esbuild bundles
 * all of it into one self-contained IIFE that we inline into the page.
 */
import { extractBillSheet } from "../../worker/lib/extract";
import { processBillSheets } from "../../worker/lib/transform";
import { buildFilledWorkbook } from "../../worker/lib/xlsx-inject";
import { TEMPLATE_XLSM_BASE64 } from "../../worker/assets/template";
import type { BillSheet, UploadRow, MissingRow } from "../../worker/lib/types";
import { lookupPrice, formatReport, normalizeCode } from "../../worker/lib/price-lookup";
import { PRICE_DATA } from "../../worker/lib/price-data";

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

/** Parse one PDF file's bytes into a BillSheet. */
async function parse(name: string, bytes: Uint8Array): Promise<BillSheet> {
	return extractBillSheet(name, bytes);
}

/**
 * Map parsed bill sheets to upload rows + missing-case rows + per-file summary.
 * `knownCaseIds` are the Case IDs already in the master sheet, so a re-submitted
 * bill sheet is skipped instead of duplicated.
 */
function toRows(sheets: BillSheet[], knownCaseIds: string[] = []) {
	return processBillSheets(sheets, knownCaseIds);
}

/** Build the filled .xlsm from accumulated rows. */
function xlsm(uploadRows: UploadRow[], missingRows: MissingRow[]): Uint8Array {
	return buildFilledWorkbook(base64ToBytes(TEMPLATE_XLSM_BASE64), uploadRows, missingRows);
}

export const AbyrxKaiser = { parse, toRows, xlsm };
// Also hang it on the global so the inline page script can reach it.
(globalThis as unknown as { AbyrxKaiser: typeof AbyrxKaiser }).AbyrxKaiser = AbyrxKaiser;

/** Price Information tool — pure offline lookup over the baked KAIRUKU snapshot. */
export const AbyrxPrice = {
	lookup: (code: string) => lookupPrice(code),
	report: formatReport,
	normalizeCode,
	generatedAt: PRICE_DATA.generatedAt,
	facilityCount: PRICE_DATA.facilityCount,
};
(globalThis as unknown as { AbyrxPrice: typeof AbyrxPrice }).AbyrxPrice = AbyrxPrice;
