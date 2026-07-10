/**
 * Build worker/lib/price-data.ts from the KAIRUKU snapshot.
 *
 *   node scripts/gen-price-data.mjs <details.jsonl> <systems.json> <YYYY-MM-DD>
 *
 * details.jsonl : one JSON facility per line { id,name,city,state,idn,prods:[{product,status,price}] }
 * systems.json  : { "<id>": { system, method }, ... }  (from cluster.py)
 *
 * Emits a compact, offline-only dataset: every facility keyed by code, its
 * Approved products (+ Estimated Approved Price), and system -> member codes.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [detailsPath, systemsPath, dateArg] = process.argv.slice(2);
if (!detailsPath || !systemsPath || !dateArg) {
	console.error("usage: gen-price-data.mjs <details.jsonl> <systems.json> <YYYY-MM-DD>");
	process.exit(1);
}

const systems = JSON.parse(readFileSync(systemsPath, "utf8"));
const lines = readFileSync(detailsPath, "utf8").split("\n").filter(Boolean);

// Display-name overrides: KAIRUKU's product label -> how we want it shown.
// Keyed case-insensitively on the trimmed KAIRUKU name.
const PRODUCT_RENAME = {
	"montage 2cc": "MONTAGE 2cc (4-pack)",
};
function displayName(name) {
	return PRODUCT_RENAME[name.trim().toLowerCase()] || name.trim();
}

const facilities = {};
const systemMembers = {};
let approvedTotal = 0;

for (const line of lines) {
	let f;
	try {
		f = JSON.parse(line);
	} catch {
		continue;
	}
	const code = String(f.id);
	const sys = systems[code] || { system: null, method: "singleton" };
	const approved = (f.prods || [])
		.filter((p) => /approved/i.test(p.status || ""))
		.map((p) => ({ product: displayName(p.product || ""), price: (p.price || "").trim() || "$0.00" }))
		.filter((p) => p.product && p.product !== "?");
	// Duplicate rows (same facility fetched by more than one scrape lane) simply
	// overwrite — facilities is keyed by code, so each facility appears once.
	facilities[code] = {
		name: (f.name || "").trim(),
		city: (f.city || "").trim(),
		state: (f.state || "").trim(),
		system: sys.system,
		method: sys.method,
		approved,
	};
}

// Build system -> members from the DEDUPED facilities (one entry per code),
// then sort numerically for deterministic output.
for (const [code, rec] of Object.entries(facilities)) {
	approvedTotal += rec.approved.length;
	if (rec.system) (systemMembers[rec.system] ||= []).push(code);
}
for (const k of Object.keys(systemMembers)) {
	systemMembers[k].sort((a, b) => Number(a) - Number(b));
}

const dataset = {
	generatedAt: dateArg,
	facilityCount: Object.keys(facilities).length,
	facilities,
	systems: systemMembers,
};

const banner = `/**
 * KAIRUKU price snapshot — GENERATED, do not edit by hand.
 * Rebuild with: node scripts/gen-price-data.mjs <details.jsonl> <systems.json> <date>
 * Snapshot: ${dateArg} · ${dataset.facilityCount} facilities · ${approvedTotal} approved product rows.
 */
import type { PriceDataset } from "./price-types";

export const PRICE_DATA: PriceDataset = ${JSON.stringify(dataset)};
`;

writeFileSync("worker/lib/price-data.ts", banner);
console.log(
	`wrote worker/lib/price-data.ts — ${dataset.facilityCount} facilities, ` +
		`${Object.keys(systemMembers).length} systems, ${approvedTotal} approved rows`,
);
