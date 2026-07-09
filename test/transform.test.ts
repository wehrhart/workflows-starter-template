import { describe, it, expect } from "vitest";
import { resolveLocationId, orScore } from "../worker/lib/locations";
import {
	combineProducts,
	billSheetToRows,
	processBillSheets,
	DEFAULT_UOM,
} from "../worker/lib/transform";
import type { BillSheet } from "../worker/lib/types";

// A BillSheet mirroring the real ABYRX Bill Sheet 80485 (Case ID missing).
const abyrx80485: BillSheet = {
	sourceFile: "ABYRX_Bill_Sheet_80485.pdf",
	caseId: null,
	surgeryDate: "07/06/2026",
	surgeonName: "James Jackman",
	procedure: "Tibial Plateau ORIF",
	hospitalName: "Kaiser Sunnyside Medical Center",
	repName: "Christopher Turner",
	repEmail: null,
	shippingAddress: "10180 SE Sunnyside Road, Clackamas, OR 97015",
	shippingZip: "97015",
	products: [
		{
			productNumber: "OS-MON-1001",
			description: "MONTAGE 5cc",
			unitsUsed: 1,
			pricePerUnit: 1448,
			totalPrice: 1448,
			lotNumber: "20387",
		},
		{
			productNumber: "OS-MON-1001",
			description: "MONTAGE 5cc",
			unitsUsed: 1,
			pricePerUnit: 1448,
			totalPrice: 1448,
			lotNumber: "20387",
		},
	],
};

describe("resolveLocationId", () => {
	it("locks Kaiser Sunnyside (97015) to 10702 via override", () => {
		const r = resolveLocationId("97015", "10180 SE Sunnyside Road");
		expect(r.locationId).toBe("10702");
	});

	it("uses the sole candidate for a single-location zip", () => {
		const r = resolveLocationId("97124", "2875 NE Stucki Ave");
		expect(r.locationId).toBe("10708"); // NW Westside Med Center OR
	});

	it("prefers the plain OR over CVOR/CCL at a shared address", () => {
		// Franklin/LA style: strip override, rely on address + OR preference.
		const r = resolveLocationId("90027", "1550 N. Edgemont St.");
		expect(r.locationId).toBe("08720"); // Los Angeles Medical Ctr OR
	});

	it("defaults West LA (90034) to East Tower 08721 by lowest-ID tie-break", () => {
		const r = resolveLocationId("90034", "6041 Cadillac Ave");
		expect(r.locationId).toBe("08721");
	});

	it("returns null only for an unknown zip", () => {
		const r = resolveLocationId("00000", "nowhere");
		expect(r.locationId).toBeNull();
		expect(r.reason).toBe("unknown-zip");
	});

	it("scores a plain OR above a CVOR above a support room", () => {
		expect(orScore("Los Angeles Medical Ctr OR")).toBeGreaterThan(
			orScore("Los Angeles Medical Ctr CVOR"),
		);
		expect(orScore("Los Angeles Medical Ctr CVOR")).toBeGreaterThan(
			orScore("LAMC IR"),
		);
	});
});

describe("combineProducts", () => {
	it("combines duplicate product numbers: qty = count, price = summed total", () => {
		const combined = combineProducts(abyrx80485.products);
		expect(combined).toHaveLength(1);
		expect(combined[0].productNumber).toBe("OS-MON-1001");
		expect(combined[0].quantity).toBe(2);
		expect(combined[0].unitPrice).toBe(2896); // 1448 + 1448
	});

	it("keeps distinct product numbers on separate rows", () => {
		const combined = combineProducts([
			{ productNumber: "A", description: "a", unitsUsed: 1, pricePerUnit: 10, totalPrice: 10 },
			{ productNumber: "B", description: "b", unitsUsed: 1, pricePerUnit: 20, totalPrice: 20 },
		]);
		expect(combined).toHaveLength(2);
	});

	it("sums units used when a single line already has multiple units", () => {
		const combined = combineProducts([
			{ productNumber: "A", description: "a", unitsUsed: 3, pricePerUnit: 10, totalPrice: 30 },
		]);
		expect(combined[0].quantity).toBe(3);
		expect(combined[0].unitPrice).toBe(30);
	});
});

describe("billSheetToRows", () => {
	it("routes a missing Case ID to the Missing Case ID tab with rep/date/surgeon", () => {
		const { uploadRows, missingRows } = billSheetToRows(abyrx80485);
		expect(uploadRows).toHaveLength(0);
		expect(missingRows).toHaveLength(1);
		const [caseId, date, surgeon, rep, hospital] = missingRows[0];
		expect(caseId).toBe("");
		expect(date).toBe("07/06/2026");
		expect(surgeon).toBe("James Jackman");
		expect(rep).toBe("Christopher Turner");
		expect(hospital).toBe("Kaiser Sunnyside Medical Center");
	});

	it("maps a present Case ID into the upload columns", () => {
		const withId: BillSheet = { ...abyrx80485, caseId: "12345678" };
		const { uploadRows, missingRows } = billSheetToRows(withId);
		expect(missingRows).toHaveLength(0);
		expect(uploadRows).toHaveLength(1);
		const row = uploadRows[0];
		expect(row.A).toBe("10702"); // Surgery Location
		expect(row.B).toBe("12345678"); // Case ID
		expect(row.C).toBe("07/06/2026"); // Surgery Date
		expect(row.D).toBe("James Jackman"); // Physician
		expect(row.G).toBe("Christopher Turner"); // Rep
		expect(row.I).toBe("OS-MON-1001"); // Supplier Item ID
		expect(row.J).toBe("MONTAGE 5cc"); // Description
		expect(row.K).toBe(2); // Quantity
		expect(row.L).toBe(DEFAULT_UOM); // UOM
		expect(row.M).toBe(2896); // Unit Price (summed)
	});
});

describe("processBillSheets", () => {
	it("aggregates a mixed batch", () => {
		const good: BillSheet = { ...abyrx80485, caseId: "87654321" };
		const result = processBillSheets([abyrx80485, good]);
		expect(result.uploadRows).toHaveLength(1);
		expect(result.missingRows).toHaveLength(1);
		expect(result.files).toHaveLength(2);
		expect(result.files[0].routed).toBe("missing-case-id");
		expect(result.files[1].routed).toBe("upload");
	});

	it("skips a sheet whose Case ID is already in the master", () => {
		const sheet: BillSheet = { ...abyrx80485, caseId: "12345678" };
		const result = processBillSheets([sheet], ["12345678"]);
		expect(result.uploadRows).toHaveLength(0);
		expect(result.files).toHaveLength(1);
		expect(result.files[0].routed).toBe("duplicate");
		expect(result.files[0].note).toContain("already in the master");
	});

	it("adds a new Case ID that is not yet in the master", () => {
		const sheet: BillSheet = { ...abyrx80485, caseId: "99999999" };
		const result = processBillSheets([sheet], ["12345678"]);
		expect(result.uploadRows).toHaveLength(1);
		expect(result.files[0].routed).toBe("upload");
	});

	it("dedupes the same Case ID repeated within one batch", () => {
		const a: BillSheet = { ...abyrx80485, caseId: "55555555" };
		const b: BillSheet = { ...abyrx80485, caseId: "55555555", sourceFile: "again.pdf" };
		const result = processBillSheets([a, b]);
		expect(result.uploadRows).toHaveLength(1); // only the first sheet's rows
		expect(result.files.map((f) => f.routed)).toEqual(["upload", "duplicate"]);
	});

	it("keeps multiple product rows for a single new Case ID", () => {
		// Two DIFFERENT products on one sheet must both stay (dedup is per sheet).
		const sheet: BillSheet = {
			...abyrx80485,
			caseId: "42424242",
			products: [
				{ productNumber: "A", description: "a", unitsUsed: 1, pricePerUnit: 10, totalPrice: 10 },
				{ productNumber: "B", description: "b", unitsUsed: 1, pricePerUnit: 20, totalPrice: 20 },
			],
		};
		const result = processBillSheets([sheet]);
		expect(result.uploadRows).toHaveLength(2);
	});
});
