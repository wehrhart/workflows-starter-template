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

/** Parse a KAIRUKU price string ("$3,000.00") to a number; 0 for blank/"$0.00". */
export function priceValue(s: string): number {
	const n = parseFloat(String(s || "").replace(/[^0-9.]/g, ""));
	return isFinite(n) ? n : 0;
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

	const homeKeys = new Set(rec.approved.map((p) => keyOf(p.product)));

	// Gather sister facilities in the same system (excluding self), ascending by code.
	const sisters: SisterFacility[] = [];
	let sisterCodes: string[] = [];
	if (rec.system) {
		const members = data.systems[rec.system] || [];
		sisterCodes = members.filter((c) => c !== code).sort((a, b) => Number(a) - Number(b));
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
		}
	}

	// Find where a product is approved across sisters — both the first sister that
	// has it at all, and the first with a real (non-zero) price. Sisters are in
	// ascending-code order, so "first" = lowest code.
	function findInSisters(k: string): {
		firstAny: { code: string; name: string; price: string } | null;
		firstReal: { code: string; name: string; price: string } | null;
	} {
		let firstAny = null as { code: string; name: string; price: string } | null;
		let firstReal = null as { code: string; name: string; price: string } | null;
		for (const sc of sisterCodes) {
			const s = data.facilities[sc];
			if (!s) continue;
			for (const p of s.approved) {
				if (keyOf(p.product) !== k) continue;
				const cand = { code: sc, name: s.name, price: p.price };
				if (!firstAny) firstAny = cand;
				if (!firstReal && priceValue(p.price) > 0) firstReal = cand;
			}
		}
		return { firstAny, firstReal };
	}

	// Home-approved products. A $0/blank price means someone flipped the status to
	// Approved but never entered a price — borrow a real price from a sister.
	const approved = rec.approved.map((p) => {
		if (priceValue(p.price) > 0) return { product: p.product, price: p.price };
		const found = findInSisters(keyOf(p.product));
		if (found.firstReal) {
			return {
				product: p.product,
				price: found.firstReal.price,
				priceFrom: { code: found.firstReal.code, name: found.firstReal.name },
			};
		}
		return { product: p.product, price: p.price };
	});

	// Products approved only at sister facilities (not at home). For each, prefer a
	// sister with a real price over one that left it at $0.
	const systemExtras: SystemExtra[] = [];
	const extraSeen = new Set<string>();
	for (const sc of sisterCodes) {
		const s = data.facilities[sc];
		if (!s) continue;
		for (const p of s.approved) {
			const k = keyOf(p.product);
			if (homeKeys.has(k) || extraSeen.has(k)) continue;
			extraSeen.add(k);
			const found = findInSisters(k);
			const src = found.firstReal || found.firstAny;
			if (!src) continue;
			systemExtras.push({
				product: p.product,
				price: src.price,
				sourceCode: src.code,
				sourceName: src.name,
			});
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
		for (const p of r.approved)
			lines.push(`${p.product} - ${p.price}${p.priceFrom ? ` (price via #${p.priceFrom.code})` : ""}`);
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
