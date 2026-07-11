/**
 * Swap ONLY the baked PRICE_DATA object inside a LIVE Abyrx Tools artifact whose
 * tools have been merged into one minified bundle by the claude.ai editor.
 * Leaves all logic, all tools, the hub, and any user edits byte-for-byte intact —
 * only the data object (facility grouping + prices) is replaced.
 *
 *   node scripts/standalone/update-artifact-data.mjs <live-artifact.html> <price-data.ts> <out.html>
 */
import { readFileSync, writeFileSync } from "node:fs";

const [livePath, dataTsPath, outPath] = process.argv.slice(2);
if (!livePath || !dataTsPath || !outPath) {
	console.error("usage: update-artifact-data.mjs <live-artifact.html> <price-data.ts> <out.html>");
	process.exit(1);
}

const html = readFileSync(livePath, "utf8");
const cStart = html.indexOf("<title>Abyrx Tools");
const cEnd = html.lastIndexOf("</script>");
let content = html.slice(cStart, cEnd + "</script>".length);

// New PRICE_DATA JSON (the object literal after `= ` in price-data.ts).
const ts = readFileSync(dataTsPath, "utf8");
const jStart = ts.indexOf("{", ts.indexOf("= "));
const jEnd = ts.lastIndexOf("}");
const newData = ts.slice(jStart, jEnd + 1);
JSON.parse(newData); // validate it's well-formed
const newDataSafe = newData.replace(/<\/script>/gi, "<\\/script>");

// Locate the baked data object by its distinctive `{generatedAt:"..."` head.
const marker = content.search(/\{generatedAt:"[0-9-]+",facilityCount:/);
if (marker === -1) throw new Error("baked PRICE_DATA object not found");

// Brace-match from that `{` to its close, skipping string literals.
function objEndOf(s, start) {
	let depth = 0, inStr = false, q = "";
	for (let i = start; i < s.length; i++) {
		const c = s[i];
		if (inStr) {
			if (c === "\\") { i++; continue; }
			if (c === q) inStr = false;
		} else if (c === '"' || c === "'") { inStr = true; q = c; }
		else if (c === "{") depth++;
		else if (c === "}") { depth--; if (depth === 0) return i; }
	}
	throw new Error("unbalanced braces in data object");
}
const end = objEndOf(content, marker);
const oldObj = content.slice(marker, end + 1);
if (!/facilities:/.test(oldObj) || !/systems:/.test(oldObj))
	throw new Error("located object is not PRICE_DATA (missing facilities/systems)");

content = content.slice(0, marker) + newDataSafe + content.slice(end + 1);

// Sanity: nothing lost.
for (const m of ["kaiser-billing", "price-quote", "price-information", "kairuku-session",
	"AbyrxKaiser", "AbyrxQuote", "AbyrxPrice", "Use Here", "P.lookup(s.code).approved"]) {
	if (!content.includes(m)) throw new Error(`post-swap sanity failed: missing ${m}`);
}

writeFileSync(outPath, content);
console.log(`wrote ${outPath} (${(content.length / 1024 / 1024).toFixed(2)} MB) — old data ${(oldObj.length/1024/1024).toFixed(2)}MB -> new ${(newDataSafe.length/1024/1024).toFixed(2)}MB`);
