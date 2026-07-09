/**
 * Simulate the artifact host: load the page inside a CROSS-ORIGIN sandboxed
 * iframe and confirm the Download control still produces a file. Tests the
 * sandbox both with and without `allow-downloads` so we know the ceiling.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import http from "node:http";

const SCRATCH =
	"/tmp/claude-0/-home-user-workflows-starter-template/9519ee99-ce8a-5c51-b633-d472196952dc/scratchpad";
const PDF = `${SCRATCH}/test-bill-sheet.pdf`;
const pageHtml = readFileSync("scripts/standalone/abyrx-tools.html");

// Serve the page so the iframe has a real, distinct origin.
const server = http.createServer((req, res) => {
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(pageHtml);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const src = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({
	executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

async function trial(sandbox) {
	const ctx = await browser.newContext({ acceptDownloads: true });
	const page = await ctx.newPage();
	const blocked = [];
	page.on("console", (m) => {
		if (/download/i.test(m.text()) && /block|sandbox/i.test(m.text())) blocked.push(m.text());
	});
	await page.setContent(
		`<!doctype html><meta charset="utf-8"><iframe id="f" ${sandbox} src="${src}" style="width:100%;height:640px;border:0"></iframe>`,
		{ waitUntil: "load" },
	);
	const frame = page.frameLocator("#f");
	await frame.locator('.toolcard[data-nav="kaiser-billing"]').click();
	await frame.locator("#file").setInputFiles(PDF);
	await frame.locator("#go").click();
	await frame.locator("table tbody tr").first().waitFor({ timeout: 15000 });

	let outcome;
	try {
		const [dl] = await Promise.all([
			page.waitForEvent("download", { timeout: 6000 }),
			frame.locator("#dl").click(),
		]);
		outcome = "download fired → " + dl.suggestedFilename();
	} catch (e) {
		outcome = "no download (" + (blocked[0] || String(e).split("\n")[0]) + ")";
	}
	await ctx.close();
	return outcome;
}

console.log("with allow-downloads:   ", await trial('sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"'));
console.log("without allow-downloads:", await trial('sandbox="allow-scripts allow-same-origin allow-popups"'));

await browser.close();
server.close();
