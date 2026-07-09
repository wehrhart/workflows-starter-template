/** Drive the Price Quote tool in the standalone page, like a user would. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PAGE = pathToFileURL("scripts/standalone/abyrx-tools.html").href;

const browser = await chromium.launch({
	executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage({ acceptDownloads: true });
const errors = [];
const external = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("request", (r) => {
	const u = r.url();
	if (!u.startsWith("file:") && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u);
});

await page.goto(PAGE, { waitUntil: "load" });

// Home shows the Price Quote card.
const homeHasQuote = await page
	.locator(".toolcard .tname", { hasText: "Price Quote Generator" })
	.count();

// Open the tool and fill the form.
await page.locator('.toolcard[data-nav="price-quote"]').click();
await page.locator("#q_hospital").fill("Jackson Health System");
await page.locator("#q_street").fill("1611 NW 12th Avenue");
await page.locator("#q_city").fill("Miami");
await page.locator("#q_state").fill("FL");
await page.locator("#q_zip").fill("33136");

// Price a few products, including OS-MON-1604 (single) which must also emit the 4-pack.
await page.locator('[data-price="OS-MON-1001"]').fill("1748");
await page.locator('[data-price="OS-MON-1604"]').fill("833");
await page.locator('[data-price="OS-401"]').fill("224");

const count = await page.locator("#q_count").innerText();

await page.locator("#q_go").click();

// The download link (a real <a download>) appears; tap it and capture the file.
await page.locator("#q_result a").waitFor({ timeout: 10000 });
const linkText = await page.locator("#q_result a").innerText();
const [dl] = await Promise.all([
	page.waitForEvent("download"),
	page.locator("#q_result a").click(),
]);
const stream = await dl.createReadStream();
const chunks = [];
for await (const c of stream) chunks.push(c);
const bytes = Buffer.concat(chunks);
const outPath = join(tmpdir(), "quote-verify.pdf");
writeFileSync(outPath, bytes);

await browser.close();

console.log("home has Price Quote card:", homeHasQuote === 1);
console.log("priced count text:", count.trim());
console.log("download link text:", linkText.replace(/\s+/g, " ").trim());
console.log("download name:", dl.suggestedFilename());
console.log("pdf bytes:", bytes.length, "magic:", bytes.slice(0, 5).toString("latin1"));
console.log("saved:", outPath);
console.log("external network requests:", external.length ? external : "(none)");
console.log("page errors:", errors.length ? errors : "(none)");
