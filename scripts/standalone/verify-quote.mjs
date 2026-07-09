/**
 * Drive the Price Quote tool in the standalone page, like a user would:
 * fill the form, hit Generate PDF, and expect the file to save in ONE click.
 *
 * Phase 1 runs the page top-level (plain <a download> path). Phase 2 embeds it
 * in a cross-origin iframe whose sandbox BLOCKS downloads (like the hosted
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

async function fill(scope) {
	await scope.locator('.toolcard[data-nav="price-quote"]').click();
	await scope.locator("#q_hospital").fill("Jackson Health System");
	await scope.locator("#q_street").fill("1611 NW 12th Avenue");
	await scope.locator("#q_city").fill("Miami");
	await scope.locator("#q_state").fill("FL");
	await scope.locator("#q_zip").fill("33136");
	await scope.locator('[data-price="OS-MON-1001"]').fill("1748");
	await scope.locator('[data-price="OS-MON-1604"]').fill("833");
	await scope.locator('[data-price="OS-401"]').fill("224");
}

// ---- Phase 1: top-level page ----
{
	const page = await browser.newPage({ acceptDownloads: true });
	const errors = [];
	const external = [];
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
	const [dl] = await Promise.all([
		page.waitForEvent("download", { timeout: 10000 }),
		page.locator("#q_go").click(),
	]);
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
	await frame.locator("#q_result a").waitFor({ timeout: 8000 });
	// give the trampoline popup a moment to fire its download
	const deadline = Date.now() + 8000;
	while (!downloads.length && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 200));
	}
	console.log("== sandboxed iframe (downloads blocked) ==");
	console.log(
		downloads.length
			? "one-click download via trampoline → " + downloads[0].suggestedFilename()
			: "NO download",
	);

	// "download again" must work with a plain left-click too
	downloads.length = 0;
	await frame.locator("#q_result a").click();
	const deadline2 = Date.now() + 8000;
	while (!downloads.length && Date.now() < deadline2) {
		await new Promise((r) => setTimeout(r, 200));
	}
	console.log(
		downloads.length
			? "download-again link → " + downloads[0].suggestedFilename()
			: "download-again link: NO download",
	);
	await ctx.close();
}

await browser.close();
server.close();
