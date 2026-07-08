import {
	LOCATION_NAMES,
	LOCATION_ADDR,
	ZIP_CANDIDATES,
} from "../data/locations";
import type { LocationResolution } from "./types";

/**
 * Zip codes locked to a specific Location ID regardless of everything else.
 * Add entries here when you want to hard-pin a facility. Seeded with the
 * cases confirmed with the customer.
 */
export const LOCATION_OVERRIDES: Record<string, string> = {
	"97015": "10702", // Kaiser Sunnyside -> NW Sunnyside Med Center OR
};

/** Normalize a street address the same way scripts/gen-locations.py does. */
export function normalizeAddress(addr: string | null | undefined): string {
	let a = String(addr ?? "").toLowerCase().trim();
	a = a.replace(/[.,]/g, " ");
	const subs: Array<[RegExp, string]> = [
		[/\broad\b/g, "rd"],
		[/\bavenue\b/g, "ave"],
		[/\bstreet\b/g, "st"],
		[/\bdrive\b/g, "dr"],
		[/\bboulevard\b/g, "blvd"],
		[/\blane\b/g, "ln"],
		[/\bcourt\b/g, "ct"],
		[/\bplace\b/g, "pl"],
		[/\bparkway\b/g, "pkwy"],
	];
	for (const [re, s] of subs) a = a.replace(re, s);
	return a.replace(/\s+/g, " ").trim();
}

/** Pull the leading street portion (before the first comma) from a full address. */
function streetOf(fullAddress: string | null | undefined): string {
	const first = String(fullAddress ?? "").split(",")[0];
	return normalizeAddress(first);
}

const BAD =
	/\b(POU|SPD|ASC|ASU|MOB|CCL|Annex|Inv|Cath|Endo|GI|Pharmacy|Lab|Radiology|Nuclear|IR|EP|Urology|URO|GYN|Cystoscopy|RAD|SPC|Ambulatory|Minor\s*Proc)\b/i;

/**
 * Score how much a facility name looks like a general operating room.
 * Higher = more likely the surgical OR we want for a bill sheet.
 */
export function orScore(name: string): number {
	let s = 0;
	if (/\bOR\b/.test(name)) s += 100; // plain "... OR" (does not match "CVOR")
	if (/\bCVOR\b/i.test(name)) s += 40; // cardiovascular OR: still an OR, ranked below plain OR
	if (/(Med(ical)?\s*(Ctr|Center|Cntr))\s*OR\s*$/i.test(name)) s += 50;
	if (BAD.test(name)) s -= 200;
	return s;
}

/**
 * Resolve column A (Surgery Location) fully deterministically:
 *   1. Zip override table wins outright.
 *   2. Narrow the zip's candidates to those whose street address matches the
 *      bill sheet's shipping address (falls back to all candidates if none match).
 *   3. Prefer the general operating room (highest orScore).
 *   4. Break any remaining tie by lowest Location ID (stable + reproducible).
 * Only an unknown zip yields a null Location ID.
 */
export function resolveLocationId(
	zip: string | null | undefined,
	shippingAddress: string | null | undefined,
): LocationResolution {
	const zip5 = String(zip ?? "").trim().slice(0, 5);
	const named = (id: string, reason: string): LocationResolution => ({
		locationId: id,
		locationName: LOCATION_NAMES[id] ?? null,
		reason,
	});

	if (LOCATION_OVERRIDES[zip5]) {
		return named(LOCATION_OVERRIDES[zip5], "override");
	}

	const candidates = ZIP_CANDIDATES[zip5] ?? [];
	if (candidates.length === 0) {
		return { locationId: null, locationName: null, reason: "unknown-zip" };
	}
	if (candidates.length === 1) {
		return named(candidates[0], "single-candidate");
	}

	const wantAddr = streetOf(shippingAddress);
	const addrMatched = wantAddr
		? candidates.filter((id) => LOCATION_ADDR[id] === wantAddr)
		: [];
	const pool = addrMatched.length > 0 ? addrMatched : candidates;
	const reason = addrMatched.length > 0 ? "address+or" : "or-preference";

	const best = [...pool].sort((a, b) => {
		const d = orScore(LOCATION_NAMES[b] ?? "") - orScore(LOCATION_NAMES[a] ?? "");
		if (d !== 0) return d;
		return a.localeCompare(b); // lowest ID wins
	})[0];

	return named(best, addrMatched.length === 1 ? "address" : reason);
}
