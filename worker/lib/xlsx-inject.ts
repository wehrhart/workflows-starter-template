import { unzipSync, zipSync } from "fflate";
import type { UploadRow, MissingRow } from "./types";

/**
 * Surgically inject data rows into the Kaiser Bill-Only .xlsm template.
 *
 * We treat the .xlsm as the zip it is and rewrite only the one worksheet's XML,
 * then add a "Missing Case ID" sheet. Everything else — the VBA macro, the
 * Locations/UOM Excel tables, the column A/L drop-down validations, styles — is
 * left byte-for-byte intact. (Round-tripping through a spreadsheet library drops
 * the tables and validations, which would break the Generate-File macro.)
 */

const COLS = [
	"A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
	"K", "L", "M", "N", "O", "P", "Q", "R", "S",
] as const;
const NUMERIC = new Set(["F", "K", "M"]); // Misc Fee, Quantity, Unit Price
const DATA_SHEET = "xl/worksheets/sheet2.xml"; // "Bill Only Spreadsheet Upload"
const DATA_START_ROW = 3; // rows 1-2 are the header + format hints

function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function cellXml(col: string, row: number, val: unknown): string {
	if (val === null || val === undefined || val === "") return "";
	const ref = `${col}${row}`;
	if (NUMERIC.has(col) && typeof val === "number" && Number.isFinite(val)) {
		return `<c r="${ref}"><v>${val}</v></c>`;
	}
	return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(val))}</t></is></c>`;
}

function dataRowXml(n: number, row: UploadRow): string {
	const cells = COLS.map((c) => cellXml(c, n, (row as Record<string, unknown>)[c])).join("");
	return `<row r="${n}" spans="1:19">${cells}</row>`;
}

/** Remove an existing <row r="n"> element (self-closing or paired). */
function removeRow(xml: string, n: number): string {
	const re = new RegExp(`<row r="${n}"(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</row>)`);
	return xml.replace(re, "");
}

/** Insert a block of row XML immediately after the row r="2" element. */
function insertAfterRow2(xml: string, block: string): string {
	const re = /<row r="2"(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/row>)/;
	const m = xml.match(re);
	if (!m || m.index === undefined) throw new Error("template: row 2 not found");
	const idx = m.index + m[0].length;
	return xml.slice(0, idx) + block + xml.slice(idx);
}

const MISSING_HEADERS = [
	"Case ID",
	"Surgery Date",
	"Surgeon Name",
	"Rep Name",
	"Hospital",
	"Source File",
	"Reason",
];

function missingSheetXml(rows: MissingRow[]): string {
	const mkRow = (n: number, arr: readonly string[]) =>
		`<row r="${n}">` +
		arr
			.map((v, i) =>
				v == null || v === ""
					? ""
					: `<c r="${COLS[i]}${n}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`,
			)
			.join("") +
		`</row>`;
	let data = mkRow(1, MISSING_HEADERS);
	rows.forEach((arr, i) => {
		data += mkRow(2 + i, arr);
	});
	return (
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
		`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
		`<sheetData>${data}</sheetData></worksheet>`
	);
}

/**
 * Produce a filled copy of the template as .xlsm bytes.
 * @param templateBytes the blank template
 * @param uploadRows    rows for "Bill Only Spreadsheet Upload" (start at row 3)
 * @param missingRows   rows for the new "Missing Case ID" tab
 */
export function buildFilledWorkbook(
	templateBytes: Uint8Array,
	uploadRows: UploadRow[],
	missingRows: MissingRow[],
): Uint8Array {
	const files = unzipSync(templateBytes);
	const dec = new TextDecoder();
	const enc = new TextEncoder();

	// 1. Inject upload rows into the data sheet.
	let sheet = dec.decode(files[DATA_SHEET]);
	let block = "";
	uploadRows.forEach((row, i) => {
		const n = DATA_START_ROW + i;
		sheet = removeRow(sheet, n);
		block += dataRowXml(n, row);
	});
	sheet = insertAfterRow2(sheet, block);
	files[DATA_SHEET] = enc.encode(sheet);

	// 2. Add the "Missing Case ID" worksheet as sheet6.xml.
	files["xl/worksheets/sheet6.xml"] = enc.encode(missingSheetXml(missingRows));

	// 3. Register it in the workbook, its rels, and content types.
	files["xl/workbook.xml"] = enc.encode(
		dec
			.decode(files["xl/workbook.xml"])
			.replace(
				"</sheets>",
				`<sheet name="Missing Case ID" sheetId="12" r:id="rId100"/></sheets>`,
			),
	);
	files["xl/_rels/workbook.xml.rels"] = enc.encode(
		dec
			.decode(files["xl/_rels/workbook.xml.rels"])
			.replace(
				"</Relationships>",
				`<Relationship Id="rId100" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet6.xml"/></Relationships>`,
			),
	);
	files["[Content_Types].xml"] = enc.encode(
		dec
			.decode(files["[Content_Types].xml"])
			.replace(
				"</Types>",
				`<Override PartName="/xl/worksheets/sheet6.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
			),
	);

	return zipSync(files);
}
