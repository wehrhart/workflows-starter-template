/** Shared types for the Abyrx Bill Sheets tool. */

/** A single product/usage line as read off a bill sheet. */
export interface ProductLine {
	productNumber: string;
	description: string;
	unitsUsed: number;
	pricePerUnit: number;
	totalPrice: number;
	lotNumber?: string;
	uid?: string;
}

/** Everything extracted from one bill sheet PDF. */
export interface BillSheet {
	sourceFile: string;
	caseId: string | null;
	surgeryDate: string | null; // MM/DD/YYYY
	surgeonName: string | null;
	procedure: string | null;
	hospitalName: string | null;
	repName: string | null;
	repEmail: string | null;
	shippingAddress: string | null;
	shippingZip: string | null;
	products: ProductLine[];
}

/**
 * A resolved column A (Surgery Location) decision. `locationId` is null only
 * when the zip is not one of the known Kaiser facilities.
 */
export interface LocationResolution {
	locationId: string | null;
	locationName: string | null;
	reason: string;
}

/** One row destined for the "Bill Only Spreadsheet Upload" sheet, keyed by column. */
export interface UploadRow {
	A?: string; // Surgery Location (Location ID)
	B?: string; // Case ID
	C?: string; // Surgery Date
	D?: string; // Physician Name
	E?: string; // WorkOrder
	F?: number; // Misc Fee Amount
	G?: string; // Rep Name
	H?: string; // Rep Email Address
	I?: string; // Supplier Item ID (product number)
	J?: string; // Item Description
	K?: number; // Quantity
	L?: string; // UOM
	M?: number; // Unit Price
	N?: string; // Model No
	O?: string; // Manufacturer Part No
	P?: string; // GTIN
	Q?: string; // Serial
	R?: string; // Lot #
}

/** One row destined for the "Missing Case ID" tab. */
export type MissingRow = [
	caseId: string,
	surgeryDate: string,
	surgeonName: string,
	repName: string,
	hospital: string,
	sourceFile: string,
	reason: string,
];

/** Result of processing a batch of bill sheets. */
export interface ProcessResult {
	uploadRows: UploadRow[];
	missingRows: MissingRow[];
	/** Per-file summary for the UI. */
	files: Array<{
		sourceFile: string;
		caseId: string | null;
		locationId: string | null;
		locationName: string | null;
		lineItems: number;
		routed: "upload" | "missing-case-id";
		note?: string;
	}>;
}
