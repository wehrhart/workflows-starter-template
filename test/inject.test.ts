import { describe, it, expect } from "vitest";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { buildFilledWorkbook } from "../worker/lib/xlsx-inject";
import type { UploadRow, MissingRow } from "../worker/lib/types";

/**
 * A minimal workbook that mirrors the parts of the real Bill-Only .xlsm that
 * buildFilledWorkbook touches, plus the parts it must leave intact (VBA macro,
 * Excel tables, and the column A/L drop-down validations). The real template
 * lives in R2 at runtime; this fixture keeps the injection logic under test
 * without shipping an 85 KB binary.
 */
function syntheticTemplate(): Uint8Array {
	const sheet2 =
		`<?xml version="1.0" encoding="UTF-8"?>` +
		`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
		`<sheetData>` +
		`<row r="1" spans="1:19"><c r="A1" t="inlineStr"><is><t>*Surgery Location</t></is></c></row>` +
		`<row r="2" spans="1:19"><c r="A2" t="inlineStr"><is><t>Choose</t></is></c></row>` +
		`<row r="3" spans="1:19"><c r="C3" s="46"/></row>` +
		`<row r="4" spans="1:19"/>` +
		`</sheetData>` +
		`<dataValidation type="list" sqref="A3:A1048576" />` +
		`<dataValidation type="list" sqref="L3:L1048576" />` +
		`</worksheet>`;
	const files: Record<string, Uint8Array> = {
		"[Content_Types].xml": strToU8(
			`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
		),
		"xl/workbook.xml": strToU8(
			`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Bill Only Spreadsheet Upload" sheetId="1" r:id="rId2"/></sheets></workbook>`,
		),
		"xl/_rels/workbook.xml.rels": strToU8(
			`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
		),
		"xl/worksheets/sheet2.xml": strToU8(sheet2),
		"xl/vbaProject.bin": new Uint8Array([1, 2, 3, 4]),
		"xl/tables/table1.xml": strToU8("<table/>"),
		"xl/tables/table2.xml": strToU8("<table/>"),
	};
	return zipSync(files);
}

const uploadRows: UploadRow[] = [
	{
		A: "10702",
		B: "12345678",
		C: "07/06/2026",
		D: "James Jackman",
		G: "Christopher Turner",
		I: "OS-MON-1001",
		J: "MONTAGE 5cc",
		K: 2,
		L: "EA",
		M: 2896,
		R: "20387",
	},
];
const missingRows: MissingRow[] = [
	[
		"",
		"07/06/2026",
		"James Jackman",
		"Christopher Turner",
		"Kaiser Sunnyside Medical Center",
		"ABYRX_Bill_Sheet_80485.pdf",
		"Case ID missing on bill sheet",
	],
];

describe("buildFilledWorkbook", () => {
	const out = buildFilledWorkbook(syntheticTemplate(), uploadRows, missingRows);
	const files = unzipSync(out);
	const dec = new TextDecoder();

	it("leaves the VBA macro and Excel tables untouched", () => {
		expect(files["xl/vbaProject.bin"]).toBeDefined();
		expect(files["xl/tables/table1.xml"]).toBeDefined();
		expect(files["xl/tables/table2.xml"]).toBeDefined();
	});

	it("keeps the column A / L drop-down validations", () => {
		const sheet = dec.decode(files["xl/worksheets/sheet2.xml"]);
		expect(sheet).toContain('sqref="A3:A1048576"');
		expect(sheet).toContain('sqref="L3:L1048576"');
	});

	it("writes the upload row into row 3 with correct values and types", () => {
		const sheet = dec.decode(files["xl/worksheets/sheet2.xml"]);
		expect(sheet).toContain('<row r="3" spans="1:19">');
		expect(sheet).toContain(">10702<");
		expect(sheet).toContain(">OS-MON-1001<");
		expect(sheet).toContain('<c r="K3"><v>2</v></c>'); // Quantity numeric
		expect(sheet).toContain('<c r="M3"><v>2896</v></c>'); // Unit Price numeric
		expect(sheet).toContain('<row r="1"'); // header preserved
	});

	it("adds and registers a Missing Case ID sheet", () => {
		expect(files["xl/worksheets/sheet6.xml"]).toBeDefined();
		const missing = dec.decode(files["xl/worksheets/sheet6.xml"]);
		expect(missing).toContain(">Christopher Turner<");
		expect(missing).toContain(">Case ID missing on bill sheet<");
		expect(dec.decode(files["xl/workbook.xml"])).toContain(
			'name="Missing Case ID"',
		);
		expect(dec.decode(files["xl/_rels/workbook.xml.rels"])).toContain(
			'Target="worksheets/sheet6.xml"',
		);
		expect(dec.decode(files["[Content_Types].xml"])).toContain(
			"/xl/worksheets/sheet6.xml",
		);
	});
});
