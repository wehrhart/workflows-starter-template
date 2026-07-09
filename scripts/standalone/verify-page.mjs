/** Drive the full standalone page in a real browser, like a user would. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SCRATCH =
	"/tmp/claude-0/-home-user-workflows-starter-template/9519ee99-ce8a-5c51-b633-d472196952dc/scratchpad";
const PDF = `${SCRATCH}/test-bill-sheet.pdf`;
const PAGE = pathToFileURL("scripts/standalone/abyrx-tools.html").href;

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

// Home shows the tool cards.
const homeHasKaiser = await page.locator(".toolcard .tname", { hasText: "Kaiser Billing" }).count();

// Open the tool, drop the PDF, process.
await page.locator('.toolcard[data-nav="kaiser-billing"]').click();
await page.locator("#file").setInputFiles(PDF);
await page.locator("#go").click();

// Wait for the results table.
await page.locator("table tbody tr").first().waitFor({ timeout: 15000 });
const row0 = await page.locator("table tbody tr").first().innerText();
const chips = await page.locator(".chips").innerText();
const masterMeta = await page.locator(".master .meta").innerText();

// Submit the SAME bill sheet again — it must be skipped, not duplicated.
await page.locator("#more").click();
await page.locator("#file").setInputFiles(PDF);
await page.locator("#go").click();
await page.locator("table tbody tr").first().waitFor({ timeout: 15000 });
const dupRow = await page.locator("table tbody tr").first().innerText();
const dupChips = await page.locator(".chips").innerText();
const masterMetaAfter = await page.locator(".master .meta").innerText();

// Download the .xlsm and inspect its first bytes.
const [dl] = await Promise.all([
	page.waitForEvent("download"),
	page.locator("#dl").click(),
]);
const stream = await dl.createReadStream();
const chunks = [];
for await (const c of stream) chunks.push(c);
const bytes = Buffer.concat(chunks);

await browser.close();

console.log("home has Kaiser card:", homeHasKaiser === 1);
console.log("result row 0:", row0.replace(/\s+/g, " ").trim());
console.log("chips:", chips.replace(/\s+/g, " ").trim());
console.log("master meta:", masterMeta.trim());
console.log("-- resubmit same sheet --");
console.log("dup row 0:", dupRow.replace(/\s+/g, " ").trim());
console.log("dup chips:", dupChips.replace(/\s+/g, " ").trim());
console.log("master meta after (should be 1 row from 1 bill sheet):", masterMetaAfter.trim());
console.log("download name:", dl.suggestedFilename());
console.log("download bytes:", bytes.length, "magic:", bytes.slice(0, 2).toString("latin1"));
console.log("external network requests:", external.length ? external : "(none)");
console.log("page errors:", errors.length ? errors : "(none)");
