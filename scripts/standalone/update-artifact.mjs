/**
 * Surgically update Price Information inside a LIVE Abyrx Tools artifact that
 * already contains it — swapping ONLY (a) the AbyrxPrice data/logic bundle and
 * (b) the Price Information render block in the hub script. Everything else
 * (Price Quote Generator, Kaiser Billing, page shell, any user edits) is left
 * byte-for-byte intact.
 *
 *   node scripts/standalone/update-artifact.mjs <live-artifact.html> <price-bundle.js> <out.html>
 *
 * live-artifact : the full HTML fetched from the live artifact (may include the
 *                 host's frame wrapper — we extract just the page content).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PRICE_FUNCTIONS } from "./price-hub-functions.mjs";

const [livePath, bundlePath, outPath] = process.argv.slice(2);
if (!livePath || !bundlePath || !outPath) {
	console.error("usage: update-artifact.mjs <live-artifact.html> <price-bundle.js> <out.html>");
	process.exit(1);
}

const html = readFileSync(livePath, "utf8");
let bundle = readFileSync(bundlePath, "utf8");
bundle = bundle.replace(/<\/script>/gi, "<\\/script>");

// Extract the page content (drop the host's doctype/frame wrapper and the
// trailing </body></html>): from <title> through the final hub </script>.
const cStart = html.indexOf("<title>Abyrx Tools");
const cEnd = html.lastIndexOf("</script>");
if (cStart === -1 || cEnd === -1) throw new Error("could not find content region");
let content = html.slice(cStart, cEnd + "</script>".length);

// --- (a) swap the AbyrxPrice bundle <script> ---
// Locate by the REAL </script> boundaries: the AbyrxPrice and main bundles
// escape any internal "</script>", so real ones only sit between elements.
// (A naive lastIndexOf("<script>") would wrongly match a <script> string
// literal embedded inside the Price Quote Generator's downloadable-quote HTML.)
const H = content.indexOf("var K = window.AbyrxKaiser;");
if (H === -1) throw new Error("hub script marker not found");
const hubScript = content.lastIndexOf("<script>", H);
const priceEnd = content.lastIndexOf("</script>", hubScript); // AbyrxPrice bundle close
const mainClose = content.lastIndexOf("</script>", priceEnd - 1); // main (Kaiser/Quote) bundle close
const priceOpen = content.indexOf("<script>", mainClose); // AbyrxPrice bundle open
const priceRegion = content.slice(priceOpen, priceEnd + "</script>".length);
if (!/AbyrxPrice/.test(priceRegion) || !/generatedAt/.test(priceRegion))
	throw new Error("located script is not the AbyrxPrice bundle — aborting to avoid damage");
// Guard: the region must NOT contain the Quote engine or hub — it should be
// only the AbyrxPrice bundle.
if (/AbyrxQuote|window\.AbyrxKaiser/.test(priceRegion))
	throw new Error("AbyrxPrice region overlaps another bundle — aborting");
content =
	content.slice(0, priceOpen) +
	`<script>${bundle}</script>` +
	content.slice(priceEnd + "</script>".length);

// --- (b) replace the Price Information render block in the hub script ---
const rStart = content.indexOf("  function priceRows(res) {");
const rEnd = content.indexOf("  function renderKaiser() {", rStart);
if (rStart === -1 || rEnd === -1 || rStart >= rEnd)
	throw new Error("could not locate Price Information render block");
content = content.slice(0, rStart) + PRICE_FUNCTIONS + content.slice(rEnd);

// Sanity: all three tools still declared, nothing dropped.
for (const marker of ["kaiser-billing", "price-quote", "price-information", "AbyrxKaiser", "AbyrxQuote", "AbyrxPrice"]) {
	if (!content.includes(marker)) throw new Error(`post-update sanity check failed: missing ${marker}`);
}

writeFileSync(outPath, content);
console.log(`wrote ${outPath} (${(content.length / 1024 / 1024).toFixed(2)} MB)`);
