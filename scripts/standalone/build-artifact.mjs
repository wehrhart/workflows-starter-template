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
 */
import { readFileSync, writeFileSync } from "node:fs";

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
page = replaceOnce(
	page,
	hubOpen,
	`<script>${bundle}</script>\n${hubOpen}`,
	"hub script opening",
);

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
const PRICE_FUNCTIONS = `  function priceRows(res) {
    var rows = "";
    res.approved.forEach(function (p) {
      rows += '<tr><td>' + esc(p.product) + '</td><td class="num">' + esc(p.price) +
        '</td><td><span class="badge ok">This facility</span></td></tr>';
    });
    res.systemExtras.forEach(function (p) {
      rows += '<tr><td>' + esc(p.product) + '</td><td class="num">' + esc(p.price) +
        '</td><td><span class="badge warn" title="' + esc(p.sourceName) + '">#' +
        esc(p.sourceCode) + ' \\u00b7 sister</span></td></tr>';
    });
    return rows;
  }

  function priceResultView() {
    var res = priceResult;
    if (!res) return "";
    if (!res.found) {
      var msg = res.code
        ? "No facility with code #" + esc(res.code) + " in the snapshot."
        : "Enter a facility code to look up.";
      return '<div class="chip warn" style="margin-top:16px;display:inline-block">' + msg + '</div>';
    }
    var f = res.facility;
    var sub = esc(f.city) + ", " + esc(f.state) +
      (res.systemName ? " \\u00b7 " + esc(res.systemName) : " \\u00b7 no health system matched");
    var chips = '<span class="chip ok">' + res.approved.length + ' approved here</span>';
    if (res.systemExtras.length) chips += '<span class="chip warn">+' + res.systemExtras.length + ' from sister facilities</span>';
    if (res.sisters.length) chips += '<span class="chip neutral">' + res.sisters.length + ' sister facilities</span>';

    var total = res.approved.length + res.systemExtras.length;
    var table = total === 0
      ? '<div class="meta" style="margin-top:16px">No products are approved at this facility or its sister facilities in the snapshot.</div>'
      : '<div class="tablewrap" style="margin-top:16px"><table><thead><tr>' +
        '<th>Product</th><th>Price</th><th>Source</th></tr></thead><tbody>' + priceRows(res) +
        '</tbody></table></div>';

    var sisters = "";
    if (res.sisters.length) {
      var items = res.sisters.map(function (s) {
        return '<li>#' + esc(s.code) + ' \\u00b7 ' + esc(s.name) + ' \\u2014 ' + esc(s.city) + ', ' + esc(s.state) +
          (s.approvedCount > 0 ? ' \\u00b7 ' + s.approvedCount + ' approved' : '') + '</li>';
      }).join("");
      sisters = '<details style="margin-top:16px"><summary style="cursor:pointer;color:var(--muted);font-size:14px">' +
        'Sister facilities checked (' + res.sisters.length + ') \\u2014 verify these are the right system</summary>' +
        '<ul style="margin:8px 0 0;padding-left:18px;font-size:12px;color:var(--muted)">' + items + '</ul></details>';
    }

    return '<div style="margin-top:20px">' +
      '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline">' +
      '<div><div class="label" style="font-size:16px">' + esc(f.name) +
      ' <span style="color:var(--faint);font-weight:400;font-size:14px">#' + esc(res.code) + '</span></div>' +
      '<div class="meta">' + sub + '</div></div>' +
      '<button class="btn ghost" id="pcopy" style="padding:6px 12px;font-size:12px">' +
      (priceCopied ? "Copied \\u2713" : "Copy report") + '</button></div>' +
      '<div class="chips" style="margin-top:12px">' + chips + '</div>' +
      table + sisters + '</div>';
  }

  function renderPrice() {
    return '<div class="wrap">' +
      '<div style="margin-bottom:20px"><h1 class="page">Price Information</h1>' +
      '<p class="sub">Enter a facility code \\u2014 get every approved product and price for that facility, ' +
      'plus approvals from its sister facilities in the same health system.</p></div>' +
      '<div class="card">' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
      '<input id="pcode" value="' + esc(priceInput) + '" inputmode="numeric" ' +
      'placeholder="Facility code, e.g. 6443 or FA6443" ' +
      'style="flex:1;min-width:0;border:1px solid var(--border-strong);border-radius:12px;' +
      'padding:10px 16px;font:inherit;font-size:14px;background:var(--surface-solid);color:var(--text)">' +
      '<button class="btn" id="plook">Look up</button></div>' +
      priceResultView() + '</div>' +
      '<p class="note">Snapshot of KAIRUKU as of ' + esc(P.generatedAt) + ' \\u00b7 ' + P.facilityCount +
      ' facilities. Health systems are inferred from facility names (KAIRUKU has no system field), so ' +
      'sister facilities are a best-effort match \\u2014 check the list before relying on cross-facility approvals. ' +
      'Everything runs right here in your browser.</p></div>';
  }

  function runPriceLookup() {
    priceCopied = false;
    priceResult = P.lookup(priceInput);
    render();
  }

  function wirePrice() {
    var pcode = document.getElementById("pcode");
    if (pcode) {
      pcode.oninput = function (e) { priceInput = e.target.value; };
      pcode.onkeydown = function (e) { if (e.key === "Enter") runPriceLookup(); };
      pcode.focus();
      var v = pcode.value; pcode.value = ""; pcode.value = v;
    }
    var plook = document.getElementById("plook");
    if (plook) plook.onclick = runPriceLookup;
    var pcopy = document.getElementById("pcopy");
    if (pcopy) pcopy.onclick = function () {
      if (!priceResult) return;
      var text = P.report(priceResult);
      var done = function () { priceCopied = true; render(); setTimeout(function () { priceCopied = false; render(); }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      }
    };
  }

`;
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
	"  function wire(r) {\n    if (r === \"kaiser-billing\") {",
	"  function wire(r) {\n    if (r === \"price-information\") { wirePrice(); return; }\n    if (r === \"kaiser-billing\") {",
	"wire dispatch",
);

writeFileSync(outPath, page);
console.log(`wrote ${outPath} (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
