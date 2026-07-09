import { extractText, getDocumentProxy } from "unpdf";
import type { BillSheet, ProductLine } from "./types";

/**
 * Bill sheets are read deterministically — no cloud AI, so the app runs fully
 * locally (`npm run dev`) with no Cloudflare login. `unpdf` (a Workers-friendly
 * build of pdf.js) turns the PDF into text; the parser below anchors on the
 * sheet's field labels, which render with noisy inter-letter spacing, so every
 * label match is spacing-tolerant.
 */

/** Extract raw text from a PDF using unpdf (runs in the Workers runtime). */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
	const pdf = await getDocumentProxy(bytes);
	const { text } = await extractText(pdf, { mergePages: true });
	return Array.isArray(text) ? text.join("\n") : text;
}

/** Build a spacing-tolerant regex for a label whose letters may be split by spaces. */
function labelRe(label: string): RegExp {
	const chars = label
		.replace(/\s+/g, "")
		.split("")
		.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	return new RegExp(chars.join("\\s*"), "gi");
}

/** End index of the last occurrence of `label` before `before`. */
function lastLabelEnd(text: string, label: string, before: number): number {
	const re = labelRe(label);
	let end = -1;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) && m.index < before) end = m.index + m[0].length;
	return end;
}

/**
 * Every field label on the sheet, in roughly document order. We locate all of
 * them, then read each field's value as the text up to *whichever* label comes
 * next — so an empty or reordered field (e.g. a blank Procedure) can't let one
 * value bleed into the next.
 */
const FIELD_LABELS = [
	"Date of Surgery",
	"Surgeon's Name",
	"Procedure",
	"Where Used",
	"Case Details",
	"Case Information",
	"Hospital Information",
	"Vendor Name",
	"Contact",
	"Shipping Address",
	"Billing Address",
	"Phone",
	"Fax",
	"Rep Name",
	"Product Usage Information",
] as const;

/** First occurrence index of each label present in the text. */
function labelPositions(text: string): Map<string, number> {
	const pos = new Map<string, number>();
	for (const label of FIELD_LABELS) {
		const m = labelRe(label).exec(text);
		if (m) pos.set(label, m.index);
	}
	return pos;
}

/** Value of `label`: text from its (doubled) end up to the next label present. */
function fieldValue(text: string, pos: Map<string, number>, label: string): string {
	const p = pos.get(label);
	if (p === undefined) return "";
	let next = text.length;
	for (const [other, idx] of pos) {
		if (other !== label && idx > p && idx < next) next = idx;
	}
	const end = lastLabelEnd(text, label, next);
	return end < 0 ? "" : text.slice(end, next).trim();
}

function num(s: string): number {
	return parseFloat(s.replace(/[$,]/g, "")) || 0;
}

/**
 * Pull the usable Case ID out of the case field. The Case ID is numeric, so we
 * just grab the number on that line no matter what precedes it — e.g.
 * "E-settlements case #3859691" or "case ## 3859691" both yield "3859691".
 * No digits on the line means no Case ID (routes to the Missing Case ID tab).
 */
export function extractCaseId(raw: string): string | null {
	const t = raw.trim();
	if (!t) return null;
	// Prefer a number that follows "#" or the word "case"; otherwise the last
	// run of digits on the line.
	const afterHash = t.match(/#+\s*(\d{3,})/);
	if (afterHash) return afterHash[1];
	const afterCase = t.match(/case[^0-9]*(\d{3,})/i);
	if (afterCase) return afterCase[1];
	const digits = t.match(/\d{3,}/g);
	if (digits) return digits[digits.length - 1];
	return null;
}

/** Parse the fields of an Abyrx/Kaiser bill sheet out of its extracted text. */
export function parseBillSheetText(text: string, fileName: string): BillSheet {
	const pos = labelPositions(text);
	const surgeryDate = (text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/) || [])[1] ?? null;
	const surgeon = fieldValue(text, pos, "Surgeon's Name");
	const procedure = fieldValue(text, pos, "Procedure");
	// Sheets label the case-ID field either "Case Details" or "Case Information";
	// read whichever one carries a value.
	const caseId = extractCaseId(
		fieldValue(text, pos, "Case Details") || fieldValue(text, pos, "Case Information"),
	);
	const shipping = fieldValue(text, pos, "Shipping Address");
	const rep = fieldValue(text, pos, "Rep Name");
	// Hospital name sits between "Hospital Information" and "Vendor Name", after
	// its own "Name" label — strip that leading label off.
	const hospital = fieldValue(text, pos, "Hospital Information").replace(
		/^(?:\s*N\s*a\s*m\s*e)+\s*/i,
		"",
	);

	const zips = shipping.match(/\b\d{5}\b/g);
	const zip = zips ? zips[zips.length - 1] : null;

	// Product rows follow the "Total Price" header cell of the usage table.
	const start = lastLabelEnd(text, "Total Price", text.length);
	const section = start >= 0 ? text.slice(start) : text;
	const prodRe =
		/([A-Z0-9][A-Z0-9-]{2,})\s+(.+?)\s+(\S+)\s+(\d{6,})\s+(\d+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/g;
	const products: ProductLine[] = [];
	let pm: RegExpExecArray | null;
	while ((pm = prodRe.exec(section))) {
		products.push({
			productNumber: pm[1],
			description: pm[2].trim(),
			unitsUsed: num(pm[5]) || 1,
			pricePerUnit: num(pm[6]),
			totalPrice: num(pm[7]),
			lotNumber: pm[3] || undefined,
			uid: pm[4] || undefined,
		});
	}

	const clean = (s: string) => {
		const t = s.trim();
		return t.length ? t : null;
	};
	return {
		sourceFile: fileName,
		caseId,
		surgeryDate: normalizeDate(surgeryDate),
		surgeonName: clean(surgeon),
		procedure: clean(procedure),
		hospitalName: clean(hospital),
		repName: clean(rep),
		repEmail: null,
		shippingAddress: clean(shipping),
		shippingZip: zip,
		products,
	};
}

/** Full pipeline: PDF bytes -> parsed BillSheet. */
export async function extractBillSheet(
	fileName: string,
	bytes: Uint8Array,
): Promise<BillSheet> {
	const text = await pdfToText(bytes);
	return parseBillSheetText(text, fileName);
}

/** Coerce a date string into MM/DD/YYYY when possible. */
export function normalizeDate(d: string | null | undefined): string | null {
	if (!d) return null;
	const m = String(d).trim().match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
	if (!m) return String(d).trim();
	const mm = m[1].padStart(2, "0");
	const dd = m[2].padStart(2, "0");
	const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
	return `${mm}/${dd}/${yyyy}`;
}
