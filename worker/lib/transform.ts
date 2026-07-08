import type {
	BillSheet,
	ProductLine,
	UploadRow,
	MissingRow,
	ProcessResult,
} from "./types";
import { resolveLocationId } from "./locations";

/** Default unit of measure. Bill sheets report "Units Used" without a UOM code. */
export const DEFAULT_UOM = "EA";

/** Round currency to cents to avoid floating-point dust after summing. */
function money(n: number): number {
	return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Collapse repeated product numbers into one line each:
 *   - Quantity  = sum of Units Used across the matching lines (2, 3, ...).
 *   - Unit Price (column M) = summed total of those combined lines.
 * One row per product number per bill sheet.
 */
export function combineProducts(products: ProductLine[]): Array<{
	productNumber: string;
	description: string;
	quantity: number;
	unitPrice: number;
	lots: string;
}> {
	const groups = new Map<
		string,
		{
			productNumber: string;
			description: string;
			quantity: number;
			unitPrice: number;
			lots: string[];
		}
	>();

	for (const p of products) {
		const key = p.productNumber.trim().toUpperCase();
		if (!key) continue;
		const units = Number.isFinite(p.unitsUsed) && p.unitsUsed > 0 ? p.unitsUsed : 1;
		const lineTotal = Number.isFinite(p.totalPrice)
			? p.totalPrice
			: units * (p.pricePerUnit || 0);
		const g = groups.get(key);
		if (g) {
			g.quantity += units;
			g.unitPrice += lineTotal;
			if (p.lotNumber && !g.lots.includes(p.lotNumber)) g.lots.push(p.lotNumber);
		} else {
			groups.set(key, {
				productNumber: p.productNumber.trim(),
				description: p.description.trim(),
				quantity: units,
				unitPrice: lineTotal,
				lots: p.lotNumber ? [p.lotNumber] : [],
			});
		}
	}

	return [...groups.values()].map((g) => ({
		productNumber: g.productNumber,
		description: g.description,
		quantity: g.quantity,
		unitPrice: money(g.unitPrice),
		lots: g.lots.join(", "),
	}));
}

/** True when a case ID is present and usable. */
export function hasCaseId(caseId: string | null | undefined): boolean {
	return !!caseId && caseId.trim().length > 0;
}

/**
 * Turn one parsed bill sheet into either upload rows (case ID present) or a
 * single "Missing Case ID" row (case ID absent).
 */
export function billSheetToRows(sheet: BillSheet): {
	uploadRows: UploadRow[];
	missingRows: MissingRow[];
	file: ProcessResult["files"][number];
} {
	if (!hasCaseId(sheet.caseId)) {
		const missing: MissingRow = [
			"",
			sheet.surgeryDate ?? "",
			sheet.surgeonName ?? "",
			sheet.repName ?? "",
			sheet.hospitalName ?? "",
			sheet.sourceFile,
			"Case ID missing on bill sheet",
		];
		return {
			uploadRows: [],
			missingRows: [missing],
			file: {
				sourceFile: sheet.sourceFile,
				caseId: null,
				locationId: null,
				locationName: null,
				lineItems: sheet.products.length,
				routed: "missing-case-id",
				note: "No Case ID under Case Details",
			},
		};
	}

	const loc = resolveLocationId(sheet.shippingZip, sheet.shippingAddress);
	const combined = combineProducts(sheet.products);
	const caseId = sheet.caseId!.trim();

	const uploadRows: UploadRow[] = combined.map((c) => {
		const row: UploadRow = {
			A: loc.locationId ?? undefined,
			B: caseId,
			C: sheet.surgeryDate ?? undefined,
			D: sheet.surgeonName ?? undefined,
			G: sheet.repName ?? undefined,
			H: sheet.repEmail ?? undefined,
			I: c.productNumber,
			J: c.description,
			K: c.quantity,
			L: DEFAULT_UOM,
			M: c.unitPrice,
		};
		if (c.lots) row.R = c.lots;
		return row;
	});

	return {
		uploadRows,
		missingRows: [],
		file: {
			sourceFile: sheet.sourceFile,
			caseId,
			locationId: loc.locationId,
			locationName: loc.locationName,
			lineItems: combined.length,
			routed: "upload",
			note:
				loc.locationId === null
					? `Zip ${sheet.shippingZip ?? "?"} not found — Surgery Location left blank`
					: undefined,
		},
	};
}

/** Process a batch of parsed bill sheets into the full upload/missing row sets. */
export function processBillSheets(sheets: BillSheet[]): ProcessResult {
	const uploadRows: UploadRow[] = [];
	const missingRows: MissingRow[] = [];
	const files: ProcessResult["files"] = [];
	for (const sheet of sheets) {
		const r = billSheetToRows(sheet);
		uploadRows.push(...r.uploadRows);
		missingRows.push(...r.missingRows);
		files.push(r.file);
	}
	return { uploadRows, missingRows, files };
}
