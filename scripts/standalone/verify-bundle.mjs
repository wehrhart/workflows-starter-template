/**
 * Verify the standalone bundle actually works in a real browser:
 * PDF bytes -> unpdf parse -> rows -> .xlsm, all client-side, no dynamic-import
 * worker error. Uses the pre-installed Chromium via Playwright.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const SCRATCH =
	"/tmp/claude-0/-home-user-workflows-starter-template/9519ee99-ce8a-5c51-b633-d472196952dc/scratchpad";

const bundle = readFileSync("scripts/standalone/bundle.js", "utf8");
const pdfB64 = readFileSync(`${SCRATCH}/test-bill-sheet.pdf`).toString("base64");

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>${bundle}</script>
<script>
window.__run = async () => {
  const bin = atob(${JSON.stringify(pdfB64)});
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  const K = window.AbyrxKaiser;
  const sheet = await K.parse("test-bill-sheet.pdf", bytes);
  const rows = K.toRows([sheet]);
  const xlsm = K.xlsm(rows.uploadRows, rows.missingRows);
  return {
    caseId: sheet.caseId,
    surgeon: sheet.surgeonName,
    surgeryDate: sheet.surgeryDate,
    zip: sheet.shippingZip,
    rep: sheet.repName,
    products: sheet.products.length,
    firstProduct: sheet.products[0] || null,
    uploadRows: rows.uploadRows,
    files: rows.files,
    xlsmBytes: xlsm.length,
    xlsmMagic: String.fromCharCode(xlsm[0], xlsm[1]), // "PK" for a zip/xlsm
  };
};
</script></body></html>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.setContent(html, { waitUntil: "load" });
let result, err = null;
try {
	result = await page.evaluate(() => window.__run());
} catch (e) {
	err = String(e);
}
await browser.close();

console.log("=== page errors ===");
console.log(errors.length ? errors.join("\n") : "(none)");
console.log("=== run error ===");
console.log(err ?? "(none)");
console.log("=== result ===");
console.log(JSON.stringify(result, null, 2));
