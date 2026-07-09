/**
 * Drive the Price Quote tool in the standalone page, like a user would:
 * fill the form, hit Generate PDF, and expect the download to fire in ONE
 * click. Runs twice — as a top-level page, then inside a cross-origin
 * sandboxed iframe that simulates the artifact host.
 */
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

const pageHtml = readFileSync("scripts/standalone/abyrx-tools.html");

// Serve the page so the iframe phase has a real, distinct origin.
const server = http.createServer((req, res) => {
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(pageHtml);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const src = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
	executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

async function fillAndGenerate(page, scope) {
	await scope.locator('.toolcard[data-nav="price-quote"]').click();
	await scope.locator("#q_hospital").fill("Jackson Health System");
	await scope.locator("#q_street").fill("1611 NW 12th Avenue");
	await scope.locator("#q_city").fill("Miami");
	await scope.locator("#q_state").fill("FL");
	await scope.locator("#q_zip").fill("33136");
	await scope.locator('[data-price="OS-MON-1001"]').fill("1748");
	await scope.locator('[data-price="OS-MON-1604"]').fill("833");
	await scope.locator('[data-price="OS-401"]').fill("224");
	// ONE click on Generate must fire the download.
	const [dl] = await Promise.all([
		page.waitForEvent("download", { timeout: 10000 }),
		scope.locator("#q_go").click(),
	]);
	return dl;
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
	const dl = await fillAndGenerate(page, page);
	const stream = await dl.createReadStream();
	const chunks = [];
	for await (const c of stream) chunks.push(c);
	const bytes = Buffer.concat(chunks);
	const outPath = join(tmpdir(), "quote-verify.pdf");
	writeFileSync(outPath, bytes);
	const fallback = await page.locator("#q_result a").innerText();

	console.log("== top-level page ==");
	console.log("home has Price Quote card:", homeHasQuote === 1);
	console.log("one-click download name:", dl.suggestedFilename());
	console.log("pdf bytes:", bytes.length, "magic:", bytes.slice(0, 5).toString("latin1"));
	console.log("fallback link:", fallback.replace(/\s+/g, " ").trim());
	console.log("saved:", outPath);
	console.log("external network requests:", external.length ? external : "(none)");
	console.log("page errors:", errors.length ? errors : "(none)");
	await page.close();
}

// ---- Phase 2: cross-origin sandboxed iframe (artifact-host-like) ----
{
	const page = await browser.newPage({ acceptDownloads: true });
	await page.setContent(
		`<!doctype html><meta charset="utf-8"><iframe id="f" sandbox="allow-scripts allow-same-origin allow-downloads allow-popups" src="${src}" style="width:100%;height:720px;border:0"></iframe>`,
		{ waitUntil: "load" },
	);
	const frame = page.frameLocator("#f");
	let outcome;
	try {
		const dl = await fillAndGenerate(page, frame);
		outcome = "one-click download fired → " + dl.suggestedFilename();
	} catch (e) {
		outcome = "NO download (" + String(e).split("\n")[0] + ")";
	}
	console.log("== sandboxed iframe ==");
	console.log(outcome);
	await page.close();
}

await browser.close();
server.close();
