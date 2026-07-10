/**
 * Apply targeted, verified hub-only patches to a LIVE Abyrx Tools artifact,
 * leaving the (possibly re-bundled) tool logic and any user edits untouched.
 *
 *   node scripts/standalone/patch-live-artifact.mjs <live-artifact.html> <out.html>
 *
 * Current patch: make each sister facility in the "Sister facilities checked"
 * list an expandable row showing that facility's approved products (fetched via
 * the existing P.lookup, so no bundle change is needed).
 */
import { readFileSync, writeFileSync } from "node:fs";

const [livePath, outPath] = process.argv.slice(2);
if (!livePath || !outPath) {
	console.error("usage: patch-live-artifact.mjs <live-artifact.html> <out.html>");
	process.exit(1);
}

const html = readFileSync(livePath, "utf8");
const cStart = html.indexOf("<title>Abyrx Tools");
const cEnd = html.lastIndexOf("</script>");
if (cStart === -1 || cEnd === -1) throw new Error("could not find content region");
let content = html.slice(cStart, cEnd + "</script>".length);

function replaceOnce(needle, replacement, label) {
	const i = content.indexOf(needle);
	if (i === -1) throw new Error(`patch anchor not found: ${label}`);
	if (content.indexOf(needle, i + needle.length) !== -1) throw new Error(`patch anchor not unique: ${label}`);
	content = content.slice(0, i) + replacement + content.slice(i + needle.length);
}

// --- Patch: nested per-sister approved-products dropdown ---
const OLD_SISTERS =
	"var items = res.sisters.map(function (s) {\n" +
	"        return '<li>#' + esc(s.code) + ' · ' + esc(s.name) + ' — ' + esc(s.city) + ', ' + esc(s.state) +\n" +
	"          (s.approvedCount > 0 ? ' · ' + s.approvedCount + ' approved' : '') + '</li>';\n" +
	'      }).join("")';

const NEW_SISTERS =
	"var items = res.sisters.map(function (s) {\n" +
	"        var head = '#' + esc(s.code) + ' · ' + esc(s.name) + ' — ' + esc(s.city) + ', ' + esc(s.state);\n" +
	"        if (s.approvedCount > 0) {\n" +
	"          var sp = (P.lookup(s.code).approved || []);\n" +
	"          var prods = sp.map(function (p) { return '<li>' + esc(p.product) + ' — ' + esc(p.price) + '</li>'; }).join('');\n" +
	"          return '<li style=\"margin:2px 0\"><details><summary style=\"cursor:pointer\">' + head + ' · ' + s.approvedCount + ' approved</summary><ul style=\"margin:4px 0 6px 18px;list-style:disc\">' + prods + '</ul></details></li>';\n" +
	"        }\n" +
	"        return '<li style=\"margin:2px 0;list-style:none\">' + head + '</li>';\n" +
	'      }).join("")';

replaceOnce(OLD_SISTERS, NEW_SISTERS, "sisters render block");

// Sanity: nothing dropped.
for (const m of ["kaiser-billing", "price-quote", "price-information", "AbyrxKaiser", "AbyrxQuote", "AbyrxPrice", "Use Here"]) {
	if (!content.includes(m)) throw new Error(`post-patch sanity failed: missing ${m}`);
}

writeFileSync(outPath, content);
console.log(`wrote ${outPath} (${(content.length / 1024 / 1024).toFixed(2)} MB)`);
