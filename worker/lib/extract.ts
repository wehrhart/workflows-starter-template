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

/** The text between (the last occurrence of) `label` and the start of `nextLabel`. */
function valueBetween(text: string, label: string, nextLabel: string): string {
	const nm = labelRe(nextLabel).exec(text);
	const nextIdx = nm ? nm.index : text.length;
	const end = lastLabelEnd(text, label, nextIdx);
	return end < 0 ? "" : text.slice(end, nextIdx).trim();
}

function num(s: string): number {
	return parseFloat(s.replace(/[$,]/g, "")) || 0;
}

/** Parse the fields of an Abyrx/Kaiser bill sheet out of its extracted text. */
export function parseBillSheetText(text: string, fileName: string): BillSheet {
	const surgeryDate = (text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/) || [])[1] ?? null;
	const surgeon = valueBetween(text, "Surgeon's Name", "Procedure");
	const procedure = valueBetween(text, "Procedure", "Where Used");
	const caseId = valueBetween(text, "Case Details", "Hospital Information");
	const hospital = valueBetween(text, "Name", "Vendor Name");
	const shipping = valueBetween(text, "Shipping Address", "Billing Address");
	const rep = valueBetween(text, "Rep Name", "Product Usage Information");

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
		caseId: clean(caseId),
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
