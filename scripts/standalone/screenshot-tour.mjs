/** Capture the real Price Information UI for review. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const SC = "/tmp/claude-0/-home-user-workflows-starter-template/686fe893-c1ba-5070-bb28-d6925ef47179/scratchpad";
const content = readFileSync(`${SC}/abyrx-tools-artifact.html`, "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${content}</body></html>`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1100, height: 820 }, colorScheme: "light" });
await page.setContent(html, { waitUntil: "load" });

// 1) Home hub with all three tools.
await page.screenshot({ path: `${SC}/tour-1-home.png` });

// 2) Price Information — empty state.
await page.locator('.toolcard[data-nav="price-information"]').click();
await page.locator("#pcode").waitFor();
await page.screenshot({ path: `${SC}/tour-2-empty.png` });

// 3) Result with sister-facility approvals (Abrazo Arrowhead #1054).
await page.locator("#pcode").fill("1054");
await page.locator("#plook").click();
await page.locator("table tbody tr").first().waitFor({ timeout: 8000 });
await page.locator("details summary").click(); // expand the sister list
await page.screenshot({ path: `${SC}/tour-3-result.png` });

await browser.close();
console.log("captured tour-1-home.png, tour-2-empty.png, tour-3-result.png");
