/** Shared types for the Price Information tool. */

/** One approved product and its price at a facility. */
export interface ApprovedProduct {
	/** Display name exactly as it reads in KAIRUKU, e.g. "HEMASORB 1-Gram". */
	product: string;
	/** Estimated Approved Price string as stored in KAIRUKU, e.g. "$950.00". */
	price: string;
	/**
	 * Set when this product is approved here but had no price ($0), so the price
	 * was borrowed from a sister facility that has a real one.
	 */
	priceFrom?: { code: string; name: string };
}

/** A single facility snapshot baked from KAIRUKU. */
export interface FacilityRecord {
	name: string;
	city: string;
	state: string;
	/** Health-system label this facility was grouped into, or null if ungrouped. */
	system: string | null;
	/** How the system was assigned: "brand", "name+state", or "singleton". */
	method: string;
	/** Products marked "Approved" at this facility, in catalog order. */
	approved: ApprovedProduct[];
}

/** The full baked dataset. */
export interface PriceDataset {
	/** Snapshot date, e.g. "2026-07-09". */
	generatedAt: string;
	/** Total facilities in the snapshot. */
	facilityCount: number;
	/** facility code (as string) -> record */
	facilities: Record<string, FacilityRecord>;
	/** system label -> member facility codes */
	systems: Record<string, string[]>;
}

/** An extra approved product found at a sister facility (not approved at home). */
export interface SystemExtra extends ApprovedProduct {
	/** The sister facility's code, e.g. "5168". */
	sourceCode: string;
	sourceName: string;
}

/** A sister facility considered when gathering system-wide approvals. */
export interface SisterFacility {
	code: string;
	name: string;
	city: string;
	state: string;
	approvedCount: number;
	/** That sister's own approved products (for the per-sister drill-down). */
	approved: ApprovedProduct[];
}

/** Result of a price lookup for one facility code. */
export interface PriceLookup {
	found: boolean;
	code: string;
	facility: {
		name: string;
		city: string;
		state: string;
		system: string | null;
		method: string;
	} | null;
	/** Approved products at the queried facility. */
	approved: ApprovedProduct[];
	/** Approved products from sister facilities not already approved at home. */
	systemExtras: SystemExtra[];
	/** All sister facilities in the same system (for transparency). */
	sisters: SisterFacility[];
	systemName: string | null;
	generatedAt: string;
}
