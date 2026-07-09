/**
 * Price Information lookup — pure, offline, deterministic.
 *
 * Given a facility code, returns the approved products + prices at that
 * facility, plus any *additional* approved products found at sister facilities
 * in the same health system (tagged with the sister's code). No network: it
 * reads the baked PRICE_DATA snapshot only.
 */
import type { PriceDataset, PriceLookup, SystemExtra, SisterFacility } from "./price-types";
import { PRICE_DATA } from "./price-data";

/** Normalize whatever the user typed into a bare facility code ("FA6443" / "#6443" / "6443"). */
export function normalizeCode(input: string): string {
	return (input || "").trim().replace(/^fa/i, "").replace(/^#/, "").replace(/\D/g, "");
}

/** Match products case-insensitively on their display name. */
function keyOf(product: string): string {
	return product.trim().toLowerCase();
}

export function lookupPrice(input: string, data: PriceDataset = PRICE_DATA): PriceLookup {
	const code = normalizeCode(input);
	const empty: PriceLookup = {
		found: false,
		code,
		facility: null,
		approved: [],
		systemExtras: [],
		sisters: [],
		systemName: null,
		generatedAt: data.generatedAt,
	};
	if (!code) return empty;

	const rec = data.facilities[code];
	if (!rec) return empty;

	const approved = rec.approved.slice();
	const homeKeys = new Set(approved.map((p) => keyOf(p.product)));

	// Gather sister facilities in the same system (excluding self).
	const sisters: SisterFacility[] = [];
	const systemExtras: SystemExtra[] = [];
	const extraSeen = new Set<string>();

	if (rec.system) {
		const members = data.systems[rec.system] || [];
		// Deterministic order: numeric ascending by code.
		const sisterCodes = members
			.filter((c) => c !== code)
			.sort((a, b) => Number(a) - Number(b));
		for (const sc of sisterCodes) {
			const s = data.facilities[sc];
			if (!s) continue;
			sisters.push({
				code: sc,
				name: s.name,
				city: s.city,
				state: s.state,
				approvedCount: s.approved.length,
			});
			for (const p of s.approved) {
				const k = keyOf(p.product);
				// Only products not approved at home, and only the first sister that has each.
				if (homeKeys.has(k) || extraSeen.has(k)) continue;
				extraSeen.add(k);
				systemExtras.push({
					product: p.product,
					price: p.price,
					sourceCode: sc,
					sourceName: s.name,
				});
			}
		}
	}

	return {
		found: true,
		code,
		facility: {
			name: rec.name,
			city: rec.city,
			state: rec.state,
			system: rec.system,
			method: rec.method,
		},
		approved,
		systemExtras,
		sisters,
		systemName: rec.system,
		generatedAt: data.generatedAt,
	};
}

/**
 * Render the lookup as the plain-text report the user copies: each approved
 * product as "Name - $price", then system extras as "Name - $price (#code)".
 */
export function formatReport(r: PriceLookup): string {
	if (!r.found || !r.facility) {
		return r.code
			? `No facility found for #${r.code} in the snapshot.`
			: "Enter a facility code.";
	}
	const lines: string[] = [];
	lines.push(`${r.facility.name} (#${r.code}) — ${r.facility.city}, ${r.facility.state}`);
	lines.push("");
	if (r.approved.length) {
		for (const p of r.approved) lines.push(`${p.product} - ${p.price}`);
	} else {
		lines.push("(no products approved at this facility)");
	}
	if (r.systemExtras.length) {
		lines.push("");
		lines.push(`Also approved elsewhere in ${r.systemName}:`);
		for (const e of r.systemExtras) lines.push(`${e.product} - ${e.price} (#${e.sourceCode})`);
	}
	return lines.join("\n");
}
