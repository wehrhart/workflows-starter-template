/**
 * Simulate the artifact host under several sandbox policies and see whether the
 * Download control produces a file — now via the "open a fresh tab that saves
 * the file" approach, with the in-iframe <a download> as the fallback.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import http from "node:http";

const SCRATCH =
	"/tmp/claude-0/-home-user-workflows-starter-template/9519ee99-ce8a-5c51-b633-d472196952dc/scratchpad";
const PDF = `${SCRATCH}/test-bill-sheet.pdf`;
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

async function trial(label, sandbox) {
	const ctx = await browser.newContext({ acceptDownloads: true });

	// Catch a download and a popup from ANY page in the context, listeners
	// attached up front so an auto-fired download can't slip past.
	let sawDownload = null, sawPopup = false;
	ctx.on("page", (p) => {
		sawPopup = true;
		p.on("download", (d) => { sawDownload = d.suggestedFilename(); });
	});

	const page = await ctx.newPage();
	page.on("download", (d) => { sawDownload = d.suggestedFilename(); });
	await page.setContent(
		`<!doctype html><meta charset="utf-8"><iframe id="f" ${sandbox} src="${src}" style="width:100%;height:640px;border:0"></iframe>`,
		{ waitUntil: "load" },
	);
	const frame = page.frameLocator("#f");
	await frame.locator('.toolcard[data-nav="kaiser-billing"]').click();
	await frame.locator("#file").setInputFiles(PDF);
	await frame.locator("#go").click();
	await frame.locator("table tbody tr").first().waitFor({ timeout: 15000 });

	await frame.locator("#dl").click();
	// give the popup time to open and its onload download to fire
	await page.waitForTimeout(1500);
	// if a popup opened but didn't auto-download, click its Save button
	if (sawPopup && !sawDownload) {
		const pages = ctx.pages();
		const pop = pages[pages.length - 1];
		await pop.locator("#save").click().catch(() => {});
		await page.waitForTimeout(1500);
	}

	const outcome = sawDownload
		? `saved ${sawDownload}${sawPopup ? " (via new tab)" : " (in-iframe)"}`
		: sawPopup
			? "new tab opened, download still blocked"
			: "no popup, no download";
	await ctx.close();
	console.log(label.padEnd(34), "→", outcome);
}

await trial("allow-downloads (in-iframe)", 'sandbox="allow-scripts allow-same-origin allow-downloads"');
await trial("popups escape sandbox", 'sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"');
await trial("popups inherit sandbox", 'sandbox="allow-scripts allow-same-origin allow-popups"');
await trial("no popups / no downloads", 'sandbox="allow-scripts allow-same-origin"');

await browser.close();
server.close();
