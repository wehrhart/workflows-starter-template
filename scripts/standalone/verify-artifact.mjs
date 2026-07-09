/**
 * Verify the MERGED artifact: all three tools present and working, and the two
 * pre-existing tools (Kaiser Billing, Price Quote Generator) are not broken by
 * the Price Information injection. Wraps the content like the artifact host does.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const SC = "/tmp/claude-0/-home-user-workflows-starter-template/686fe893-c1ba-5070-bb28-d6925ef47179/scratchpad";
const content = readFileSync(`${SC}/abyrx-tools-artifact.html`, "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${content}</body></html>`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage();
const errors = [];
const external = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("request", (r) => {
	const u = r.url();
	if (!/^(data|blob|about):/.test(u) && u !== "chrome-error://chromewebdata/") external.push(u);
});

await page.setContent(html, { waitUntil: "load" });

// Home: all three active tools + the placeholder.
const cards = await page.locator(".toolcard .tname").allInnerTexts();

// Price Information end-to-end (Abrazo Arrowhead: approvals + sister approvals).
await page.locator('.toolcard[data-nav="price-information"]').click();
await page.locator("#pcode").fill("1054");
await page.locator("#plook").click();
await page.locator("table tbody tr").first().waitFor({ timeout: 8000 });
const priceFacility = await page.locator(".card .label").first().innerText();
const priceRows = await page.locator("table tbody tr").allInnerTexts();

// Price Quote Generator still renders its form (navigate by hash, wait for heading).
await page.evaluate(() => { location.hash = "#/price-quote"; });
await page.locator("h1.page", { hasText: "Price Quote Generator" }).waitFor({ timeout: 8000 });
const quoteInputs = await page.locator("#q_go, .qin, [data-price], input").count();
const quoteHeading = await page.locator("h1.page").first().innerText();

// Kaiser Billing still renders its dropzone.
await page.evaluate(() => { location.hash = "#/kaiser-billing"; });
await page.locator("h1.page", { hasText: "Kaiser Billing" }).waitFor({ timeout: 8000 });
const kaiserDrop = await page.locator("#drop, #file").count();
const kaiserHeading = await page.locator("h1.page").first().innerText();

await browser.close();

console.log("=== Merged artifact verification ===");
console.log("tool cards on home:", cards.map((c) => c.trim()));
console.log("-- Price Information (1054) --");
console.log("facility:", priceFacility.replace(/\s+/g, " ").trim());
for (const r of priceRows) console.log("   row:", r.replace(/\s+/g, " ").trim());
console.log("-- Price Quote Generator --");
console.log("heading:", quoteHeading.trim(), "| form elements:", quoteInputs);
console.log("-- Kaiser Billing --");
console.log("heading:", kaiserHeading.trim(), "| dropzone elements:", kaiserDrop);
console.log("external network requests:", external.length ? external : "(none)");
console.log("page errors:", errors.length ? errors : "(none)");
