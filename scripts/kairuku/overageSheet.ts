/**
 * Overage reps sheet — the running list of reps whose demo entries couldn't be
 * completed. Three columns: Rep Name, Date, Type — where Type is "montage",
 * "montage flowable" (overage hit on that entry), or "NOT IN k." (rep not
 * found in Kairuku's Distributors search).
 *
 * Stored as JSON in the local, gitignored .kairuku-data/ folder so it keeps
 * accumulating across runs and app restarts; downloadable as a real .xlsx.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";

export const KAIRUKU_DATA_DIR = path.resolve(
	process.env.KAIRUKU_DATA_DIR ?? ".kairuku-data",
);
const OVERAGE_FILE = path.join(KAIRUKU_DATA_DIR, "overage-reps.json");

export interface OverageRow {
	rep: string;
	/** MM/DD/YYYY (local time, the day the case was logged). */
	date: string;
	/** "montage" | "montage flowable" | "NOT IN k." */
	type: string;
}

function ensureDir() {
	if (!existsSync(KAIRUKU_DATA_DIR)) mkdirSync(KAIRUKU_DATA_DIR, { recursive: true });
}

export function getOverageRows(): OverageRow[] {
	try {
		return JSON.parse(readFileSync(OVERAGE_FILE, "utf8")) as OverageRow[];
	} catch {
		return [];
	}
}

export function addOverageRow(rep: string, type: string): OverageRow {
	ensureDir();
	const now = new Date();
	const date = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(
		now.getDate(),
	).padStart(2, "0")}/${now.getFullYear()}`;
	const rows = getOverageRows();
	const row: OverageRow = { rep, date, type };
	rows.push(row);
	writeFileSync(OVERAGE_FILE, JSON.stringify(rows, null, "\t"));
	return row;
}

// ---------------------------------------------------------------------------
// Minimal .xlsx builder (single sheet, inline strings) — just enough for a
// simple 3-column list; opens cleanly in Excel / Numbers / Sheets.
// ---------------------------------------------------------------------------

function xml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function buildOverageXlsx(): Uint8Array {
	const rows: string[][] = [
		["Rep Name", "Date", "Type"],
		...getOverageRows().map((r) => [r.rep, r.date, r.type]),
	];
	const sheetRows = rows
		.map((cells, ri) => {
			const cols = cells
				.map((v, ci) => {
					const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
					return `<c r="${ref}" t="inlineStr"><is><t>${xml(v)}</t></is></c>`;
				})
				.join("");
			return `<row r="${ri + 1}">${cols}</row>`;
		})
		.join("");

	const files: Record<string, Uint8Array> = {
		"[Content_Types].xml": strToU8(
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
				`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
				`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
				`<Default Extension="xml" ContentType="application/xml"/>` +
				`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
				`<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
				`</Types>`,
		),
		"_rels/.rels": strToU8(
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
				`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
				`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
				`</Relationships>`,
		),
		"xl/workbook.xml": strToU8(
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
				`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
				`xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
				`<sheets><sheet name="Overage reps" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		),
		"xl/_rels/workbook.xml.rels": strToU8(
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
				`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
				`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
				`</Relationships>`,
		),
		"xl/worksheets/sheet1.xml": strToU8(
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
				`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
				`<cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/><col min="3" max="3" width="20" customWidth="1"/></cols>` +
				`<sheetData>${sheetRows}</sheetData></worksheet>`,
		),
	};
	return zipSync(files, { level: 6 });
}
