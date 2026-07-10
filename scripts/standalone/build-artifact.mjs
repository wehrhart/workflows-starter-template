/**
 * Build the updated Abyrx Tools artifact by injecting the Price Information
 * tool into a COPY of the current live artifact — so Kaiser Billing and the
 * Price Quote Generator (whose engine isn't in this repo) are preserved exactly.
 *
 *   node scripts/standalone/build-artifact.mjs <base-artifact-content.html> <price-bundle.js> <out.html>
 *
 * base : the live artifact's content region (from <title> through the final
 *        hub </script>), i.e. the page WITHOUT the host's doctype/frame wrapper.
 * price-bundle : esbuild IIFE that defines window.AbyrxPrice (entry-price.ts).
 * out  : the file to publish via the Artifact tool (host adds the wrapper).
 *
 * NOTE: use this only for a base that does NOT already contain Price Information.
 * To update a live artifact that already has it, use update-artifact.mjs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PRICE_FUNCTIONS } from "./price-hub-functions.mjs";

const [basePath, bundlePath, outPath] = process.argv.slice(2);
if (!basePath || !bundlePath || !outPath) {
	console.error("usage: build-artifact.mjs <base.html> <price-bundle.js> <out.html>");
	process.exit(1);
}

let page = readFileSync(basePath, "utf8");
let bundle = readFileSync(bundlePath, "utf8");
// Never let a literal "</script>" inside the bundle close our inline script early.
bundle = bundle.replace(/<\/script>/gi, "<\\/script>");

function replaceOnce(haystack, needle, replacement, label) {
	const i = haystack.indexOf(needle);
	if (i === -1) throw new Error(`anchor not found: ${label}`);
	if (haystack.indexOf(needle, i + needle.length) !== -1)
		throw new Error(`anchor not unique: ${label}`);
	return haystack.slice(0, i) + replacement + haystack.slice(i + needle.length);
}

// 1) Inject the AbyrxPrice bundle as its own <script>, right before the hub script.
const hubOpen = '<script>\n(function () {\n  "use strict";\n  var K = window.AbyrxKaiser;';
page = replaceOnce(page, hubOpen, `<script>${bundle}</script>\n${hubOpen}`, "hub script opening");

// 2) Expose it inside the hub IIFE.
page = replaceOnce(
	page,
	"  var Q = window.AbyrxQuote;",
	"  var Q = window.AbyrxQuote;\n  var P = window.AbyrxPrice;",
	"var Q line",
);

// 3) Add the tool to the catalog (before the coming-soon placeholder).
page = replaceOnce(
	page,
	'    { id: "coming-soon", name: "Next tool", icon: "➕",',
	'    { id: "price-information", name: "Price Information", icon: "💲",\n' +
		'      tagline: "Facility code → approved products & prices, across the health system", active: true },\n' +
		'    { id: "coming-soon", name: "Next tool", icon: "➕",',
	"TOOLS catalog",
);

// 4) Route to the new render function.
page = replaceOnce(
	page,
	"    else view.innerHTML = renderHome();",
	'    else if (r === "price-information") view.innerHTML = renderPrice();\n' +
		"    else view.innerHTML = renderHome();",
	"render router",
);

// 5) Inject the render + wiring functions before renderKaiser.
page = replaceOnce(page, "  function renderKaiser() {", PRICE_FUNCTIONS + "  function renderKaiser() {", "renderKaiser anchor");

// 6) Declare the price-tool state next to the Kaiser state var block.
page = replaceOnce(
	page,
	'  var LS_KEY = "abyrx.kaiser.master.v1";',
	'  var LS_KEY = "abyrx.kaiser.master.v1";\n\n' +
		"  // ---- Price Information state ----\n" +
		'  var priceInput = "";\n' +
		"  var priceResult = null;\n" +
		"  var priceCopied = false;",
	"state block",
);

// 7) Wire the tool when its view is shown.
page = replaceOnce(
	page,
	'  function wire(r) {\n    if (r === "kaiser-billing") {',
	'  function wire(r) {\n    if (r === "price-information") { wirePrice(); return; }\n    if (r === "kaiser-billing") {',
	"wire dispatch",
);

writeFileSync(outPath, page);
console.log(`wrote ${outPath} (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
