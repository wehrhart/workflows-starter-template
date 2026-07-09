/**
 * Integrity audit for worker/lib/price-data.ts against a facility list.
 * Run after regenerating the snapshot:
 *   node scripts/check-price-data.mjs <facilities-list.json>
 * Exits non-zero if any invariant fails.
 */
import { readFileSync } from "node:fs";

const listPath = process.argv[2];
if (!listPath) { console.error("usage: check-price-data.mjs <facilities-list.json>"); process.exit(1); }
const list = JSON.parse(readFileSync(listPath, "utf8"));
const src = readFileSync("worker/lib/price-data.ts", "utf8");
const D = JSON.parse(src.slice(src.indexOf("{", src.indexOf("= ")), src.lastIndexOf("}") + 1));
const F = D.facilities, SY = D.systems;
const listIds = new Set(list.map((f) => String(f.id)));
const facIds = new Set(Object.keys(F));
const problems = [];

const missing = [...listIds].filter((id) => !facIds.has(id));
const extra = [...facIds].filter((id) => !listIds.has(id));
if (missing.length) problems.push(`${missing.length} facilities missing from data (${missing.slice(0,5)})`);
if (extra.length) problems.push(`${extra.length} facilities not in list (${extra.slice(0,5)})`);

for (const [c, f] of Object.entries(F)) {
	if (typeof f.name !== "string" || typeof f.city !== "string" || typeof f.state !== "string" || !Array.isArray(f.approved))
		problems.push(`#${c} bad core fields`);
	if (!("system" in f) || !("method" in f)) problems.push(`#${c} missing system/method`);
}
for (const [sys, ids] of Object.entries(SY)) {
	if (new Set(ids).size !== ids.length) problems.push(`system "${sys}" has duplicate members`);
	for (const id of ids) {
		if (!F[id]) problems.push(`system "${sys}" -> nonexistent #${id}`);
		else if (F[id].system !== sys) problems.push(`#${id} listed under "${sys}" but says "${F[id].system}"`);
	}
}
for (const [c, f] of Object.entries(F)) {
	if (f.system && !(SY[f.system] || []).includes(c)) problems.push(`#${c} has system "${f.system}" but not in its list`);
}

const withSys = Object.values(F).filter((f) => f.system).length;
console.log(`${facIds.size} facilities | ${Object.keys(SY).length} systems | ${withSys} grouped, ${facIds.size - withSys} independent`);
if (problems.length) { console.error("FAIL:\n  " + problems.slice(0, 30).join("\n  ")); process.exit(1); }
console.log("ALL INVARIANTS PASS");
