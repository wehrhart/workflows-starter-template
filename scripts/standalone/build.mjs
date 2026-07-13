/**
 * Inline the esbuild bundle into page.html to produce the self-contained
 * standalone Abyrx Tools page (a single hostable HTML file).
 */
import { readFileSync, writeFileSync } from "node:fs";

let page = readFileSync("scripts/standalone/page.html", "utf8");
let bundle = readFileSync("scripts/standalone/bundle.js", "utf8");

// Stamp the app version (single source of truth: src/version.ts) so the
// hosted page and the local app can be told apart at a glance.
const versionSrc = readFileSync("src/version.ts", "utf8");
const version = versionSrc.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? "unknown version";
page = page.replaceAll("__ABYRX_VERSION__", version);

// Never let a "</script>" inside the bundle close our inline <script> early.
bundle = bundle.replace(/<\/script>/gi, "<\\/script>");

const marker = "/*__ABYRX_VENDOR_BUNDLE__*/";
if (!page.includes(marker)) throw new Error("bundle marker not found in page.html");

const out = page.replace(marker, () => bundle);
const dest = "scripts/standalone/abyrx-tools.html";
writeFileSync(dest, out);
console.log(`wrote ${dest} (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
