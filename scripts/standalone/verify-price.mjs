/** Drive the Price Information tool in a real browser, like a user would. */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const PAGE = pathToFileURL("scripts/standalone/abyrx-tools.html").href;
const CODE = process.argv[2] || "1054"; // Abrazo Arrowhead: approvals + a sister with approvals

const browser = await chromium.launch({
	executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage();
const errors = [];
const external = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("request", (r) => {
	const u = r.url();
	if (!u.startsWith("file:") && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u);
});

await page.goto(PAGE, { waitUntil: "load" });

// Home shows the Price Information card.
const homeHasPrice = await page.locator(".toolcard .tname", { hasText: "Price Information" }).count();

// Open the tool, type the code, look up.
await page.locator('.toolcard[data-nav="price-information"]').click();
await page.locator("#pcode").fill(CODE);
await page.locator("#plook").click();
await page.locator("table tbody tr").first().waitFor({ timeout: 8000 });

const facilityLine = await page.locator(".card .label").first().innerText();
const chips = await page.locator(".chips").innerText();
const rows = await page.locator("table tbody tr").allInnerTexts();
const sistersSummary = await page.locator("details summary").innerText().catch(() => "(none)");

// Copy report (reads back what the button copied via the clipboard API in-page).
const report = await page.evaluate((code) => window.AbyrxPrice.report(window.AbyrxPrice.lookup(code)), CODE);

// Unknown code path.
await page.locator("#pcode").fill("999999");
await page.locator("#plook").click();
const unknown = await page.locator(".chip.warn").first().innerText().catch(() => "(no warn)");

await browser.close();

console.log("=== Price Information verify (code " + CODE + ") ===");
console.log("home has Price card:", homeHasPrice === 1);
console.log("facility line:", facilityLine.replace(/\s+/g, " ").trim());
console.log("chips:", chips.replace(/\s+/g, " ").trim());
console.log("rows:");
for (const r of rows) console.log("   " + r.replace(/\s+/g, " ").trim());
console.log("sisters summary:", sistersSummary.replace(/\s+/g, " ").trim());
console.log("-- copy report text --");
console.log(report);
console.log("-- unknown code 999999 --");
console.log("shows warning:", unknown.replace(/\s+/g, " ").trim());
console.log("external network requests:", external.length ? external : "(none)");
console.log("page errors:", errors.length ? errors : "(none)");
