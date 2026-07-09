/**
 * Drive the Price Quote tool in the standalone page, like a user would:
 * fill the form, click Generate PDF ONCE, and expect the download to start —
 * no second click, no fallback link.
 *
 * Phase 1 runs the page top-level (plain <a download> path) and checks that a
 * rapid double-click yields exactly ONE download. Phase 2 embeds the page in a
 * cross-origin iframe whose sandbox BLOCKS downloads (like the hosted
 * artifact) — there the popup-trampoline must deliver the download instead.
 */
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

const pageHtml = readFileSync("scripts/standalone/abyrx-tools.html");
const server = http.createServer((req, res) => {
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(pageHtml);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const src = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
	executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

// Price EVERY product — 12 output lines forces the table onto two pages,
// which is exactly the case that once crashed the description renderer.
async function fill(scope) {
	await scope.locator('.toolcard[data-nav="price-quote"]').click();
	await scope.locator("#q_hospital").fill("Jackson Health System");
	await scope.locator("#q_street").fill("1611 NW 12th Avenue");
	await scope.locator("#q_city").fill("Miami");
	await scope.locator("#q_state").fill("FL");
	await scope.locator("#q_zip").fill("33136");
	const inputs = scope.locator("[data-price]");
	const n = await inputs.count();
	for (let i = 0; i < n; i++) await inputs.nth(i).fill(String(100 * (i + 1)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Phase 1: top-level page ----
{
	const page = await browser.newPage({ acceptDownloads: true });
	const errors = [];
	const external = [];
	const downloads = [];
	page.on("download", (d) => downloads.push(d));
	page.on("pageerror", (e) => errors.push(String(e)));
	page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
	page.on("request", (r) => {
		const u = r.url();
		if (!u.startsWith(src) && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u);
	});
	await page.goto(src, { waitUntil: "load" });
	const homeHasQuote = await page
		.locator(".toolcard .tname", { hasText: "Price Quote Generator" })
		.count();
	await fill(page);

	// ONE click → download.
	await page.locator("#q_go").click();
	const deadline = Date.now() + 8000;
	while (!downloads.length && Date.now() < deadline) await sleep(100);
	const dl = downloads[0];
	const stream = await dl.createReadStream();
	const chunks = [];
	for await (const c of stream) chunks.push(c);
	const bytes = Buffer.concat(chunks);
	const outPath = join(tmpdir(), "quote-verify.pdf");
	writeFileSync(outPath, bytes);

	console.log("== top-level page ==");
	console.log("home has Price Quote card:", homeHasQuote === 1);
	console.log("one-click download name:", dl.suggestedFilename());
	console.log("pdf bytes:", bytes.length, "magic:", bytes.slice(0, 5).toString("latin1"));
	console.log("saved:", outPath);

	// Rapid double-click (after cooldown) must yield exactly ONE download.
	await sleep(1100);
	downloads.length = 0;
	await page.locator("#q_go").evaluate((btn) => {
		btn.click();
		btn.click(); // second click lands while the button is disabled
	});
	await sleep(2500);
	console.log("rapid double-click downloads (want 1):", downloads.length);
	console.log("external network requests:", external.length ? external : "(none)");
	console.log("page errors:", errors.length ? errors : "(none)");
	await page.close();
}

// ---- Phase 2: artifact-like sandbox (downloads BLOCKED, popups may escape) ----
{
	const ctx = await browser.newContext({ acceptDownloads: true });
	const downloads = [];
	ctx.on("page", (p) => p.on("download", (d) => downloads.push(d)));
	const page = await ctx.newPage();
	page.on("download", (d) => downloads.push(d));

	await page.setContent(
		`<!doctype html><meta charset="utf-8"><iframe id="f" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" src="${src}" style="width:100%;height:720px;border:0"></iframe>`,
		{ waitUntil: "load" },
	);
	const frame = page.frameLocator("#f");
	await fill(frame);
	await frame.locator("#q_go").click();
	const deadline = Date.now() + 8000;
	while (!downloads.length && Date.now() < deadline) await sleep(200);
	console.log("== sandboxed iframe (downloads blocked) ==");
	console.log(
		downloads.length
			? "one-click download via trampoline → " + downloads[0].suggestedFilename()
			: "NO download",
	);
	await ctx.close();
}

await browser.close();
server.close();
