import { describe, it, expect } from "vitest";
import {
	parseBillSheetText,
	normalizeDate,
	extractCaseId,
} from "../worker/lib/extract";

// Text as unpdf extracts it from the real ABYRX bill sheet 80485 (Case ID
// blank; labels render with noisy inter-letter spacing).
const TEXT_MISSING_CASE = `SE N D P O TO C U STOME RSE RV IC E @ A BYRX .C OM Surgery Information D a te o f Su rg ery 7/6/2026 Su rg eo n 's N a m e James Jackman P ro ced u re Tibial Plateau ORIF W h ere U sed C a se D eta ils Hospital Information N a m e Kaiser Sunnyside Medical Center V en d o r N a m e Abyrx, Inc. C o n ta ct Sh ip p in g A d d ress 10180 SE Sunnyside Road, Clackamas, OR 97015 Billin g A d d ress 10180 SE Sunnyside Road, Clackamas, OR 97015 P h o n e (503) 652-2880 F a x Distributor/Rep Information Rep N a m e Christopher Turner Product Usage Information P ro d u ct N u m b er D escrip tio n Lo t N u m b er U ID U n its U sed P rice P er U n it To ta l P rice OS-MON-1001 MONTAGE 5cc 20387 203870154 1.00 1,448.00 1,448.00 OS-MON-1001 MONTAGE 5cc 20387 203870684 1.00 1,448.00 1,448.00 To ta l 2,896.00 ABYRX, INC. · 700 FAIRFIELD AVENUE`;

// Same sheet but with a Case ID present under Case Details.
const TEXT_WITH_CASE = TEXT_MISSING_CASE.replace(
	"C a se D eta ils Hospital Information",
	"C a se D eta ils 80486123 Hospital Information",
);

describe("parseBillSheetText", () => {
	it("extracts all fields and detects a missing Case ID", () => {
		const s = parseBillSheetText(TEXT_MISSING_CASE, "80485.pdf");
		expect(s.caseId).toBeNull();
		expect(s.surgeryDate).toBe("07/06/2026");
		expect(s.surgeonName).toBe("James Jackman");
		expect(s.hospitalName).toBe("Kaiser Sunnyside Medical Center");
		expect(s.repName).toBe("Christopher Turner");
		expect(s.shippingZip).toBe("97015");
		expect(s.products).toHaveLength(2);
		expect(s.products[0].productNumber).toBe("OS-MON-1001");
		expect(s.products[0].description).toBe("MONTAGE 5cc");
		expect(s.products[0].pricePerUnit).toBe(1448);
	});

	it("reads a present Case ID", () => {
		const s = parseBillSheetText(TEXT_WITH_CASE, "80486.pdf");
		expect(s.caseId).toBe("80486123");
	});

	it("reads a Case ID from a 'Case Information' label", () => {
		const text = TEXT_WITH_CASE.replace(
			"C a se D eta ils 80486123 Hospital Information",
			"C a se In fo rm a tio n 80486123 Hospital Information",
		);
		const s = parseBillSheetText(text, "80486.pdf");
		expect(s.caseId).toBe("80486123");
	});

	it("takes the zip after the state, not the street number", () => {
		const s = parseBillSheetText(TEXT_MISSING_CASE, "x.pdf");
		expect(s.shippingZip).not.toBe("10180");
		expect(s.shippingZip).toBe("97015");
	});
});

// A sheet with an EMPTY Procedure field and a Case ID written with a prefix —
// the shape that used to make the Physician field swallow the labels.
const TEXT_EUGENE = `Surgery Information D a te o f Su rg ery 4/27/2026 Su rg eo n 's N a m e Eugene Jang P ro ced u re W h ere U sed C a se D eta ils E-settlements case #3859691 Hospital Information N a m e Kaiser Roseville Medical Center V en d o r N a m e Abyrx, Inc. C o n ta ct Sh ip p in g A d d ress 1600 Eureka Rd., Roseville, CA 95661 Billin g A d d ress 1600 Eureka Rd Rep N a m e Tyler Vance Product Usage Information P ro d u ct N u m b er D escrip tio n Lo t N u m b er U ID U n its U sed P rice P er U n it To ta l P rice OS-MON-1001 MONTAGE 5cc 41234 412340999 1.00 1,448.00 1,448.00 To ta l 1,448.00 ABYRX, INC.`;

describe("parseBillSheetText — empty Procedure / prefixed Case ID", () => {
	it("keeps Physician to just the name (no label bleed)", () => {
		const s = parseBillSheetText(TEXT_EUGENE, "eugene.pdf");
		expect(s.surgeonName).toBe("Eugene Jang");
	});
	it("pulls the ID out of a prefixed Case Details field", () => {
		const s = parseBillSheetText(TEXT_EUGENE, "eugene.pdf");
		expect(s.caseId).toBe("3859691");
	});
	it("still reads the other fields", () => {
		const s = parseBillSheetText(TEXT_EUGENE, "eugene.pdf");
		expect(s.surgeryDate).toBe("04/27/2026");
		expect(s.hospitalName).toBe("Kaiser Roseville Medical Center");
		expect(s.repName).toBe("Tyler Vance");
		expect(s.shippingZip).toBe("95661");
		expect(s.products[0].productNumber).toBe("OS-MON-1001");
	});
});

describe("extractCaseId", () => {
	it("takes the token after a #", () => {
		expect(extractCaseId("E-settlements case #3859691")).toBe("3859691");
	});
	it("handles doubled hashes", () => {
		expect(extractCaseId("E-settlements case ##3859691")).toBe("3859691");
	});
	it("takes a trailing ID", () => {
		expect(extractCaseId("Case 80486123")).toBe("80486123");
	});
	it("pulls the number out even with no # or 'case'", () => {
		expect(extractCaseId("E-settlements 3859691")).toBe("3859691");
	});
	it("is null when the line has no number", () => {
		expect(extractCaseId("E-settlements pending")).toBeNull();
	});
	it("is null for empty", () => {
		expect(extractCaseId("   ")).toBeNull();
	});
});

describe("normalizeDate", () => {
	it("pads to MM/DD/YYYY and expands 2-digit years", () => {
		expect(normalizeDate("7/6/2026")).toBe("07/06/2026");
		expect(normalizeDate("12/1/26")).toBe("12/01/2026");
		expect(normalizeDate(null)).toBeNull();
	});
});
