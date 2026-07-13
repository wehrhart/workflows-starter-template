/**
 * Demo Units runner — enters demo unit shipments into Kairuku using the live
 * session from the Kairuku Session tool (requireKairukuSession()).
 *
 * The workflow (verbatim from the spec):
 *  Part 1  Distributors → search rep's LAST name → 0 hits: log "NOT IN k." and
 *          stop · 1 hit: that's the distributor · many: open each →
 *          Professionals → find "Last, First" → that's the distributor.
 *  Part 2  Dashboard → UID Tracking → Demo Units → pick distributor in the
 *          dropdown (if it's NOT an option there: task complete, nothing to
 *          enter) → pick sales rep ("Last, First") → pick product → enter
 *          Demo Units Requested → "Verify Demo Unit Request".
 *  Part 3  If "Request Overage" appears: NEVER click it — log the rep on the
 *          overage sheet (type = which product) and Dashboard out; still
 *          attempt the other product entry if there is one. Otherwise click
 *          "Continue to Add".
 *  Part 4  Notes = exact per-item amounts · Units = overwrite (MONTAGE: sum;
 *          Flowable: cartridge count) · Tracking number · check fulfilled ·
 *          Save.
 *
 * Entry math:
 *  MONTAGE          qty/units = montage + permatage + hemasorb + hemasorbApply
 *  MONTAGE FLOWABLE qty/units = cartridge count (1 gun per demo, 1 cartridge
 *                   per 2 uses, 1 tip per use — the boxes arrive pre-computed)
 *
 * ── SELECTORS ──────────────────────────────────────────────────────────────
 * Everything Kairuku-specific lives in the SEL object below, written from the
 * workflow's words (link labels, button text, field labels). If a run gets
 * stuck at a step, the failure screenshot lands in .kairuku-data/debug/ —
 * adjust the matching entry here to whatever the real page shows.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { requireKairukuSession, KAIRUKU_URL } from "./kairukuSessionManager.ts";
import { addOverageRow, KAIRUKU_DATA_DIR } from "./overageSheet.ts";

const DEBUG_DIR = path.join(KAIRUKU_DATA_DIR, "debug");

/**
 * Real Kairuku selectors — confirmed by inspecting the live authenticated
 * site (ASP.NET WebForms). The Demo Units entry is the "Demo Check" widget on
 * chargesheets.aspx (reached via the UID Tracking nav). Its distributor
 * dropdown lists only the ~24 demo-eligible distributors; the sales-rep
 * dropdown repopulates (AJAX) after a distributor is chosen.
 */
const SEL = {
	/** The page that hosts the Demo Check widget. */
	demoPagePath: "chargesheets.aspx",
	navUidTracking: "UID Tracking",
	navDashboard: "Dashboard",
	/** Demo Check controls (real IDs). */
	distributorSelect: "#DistributorID_DemoCheck",
	salesRepSelect: "#SalesRepID_DemoCheck",
	productSelect: "#Item_DemoCheck",
	qtyInput: "#DemoUnitsReequested_DemoCheck", // yes, Kairuku spells it "Reequested"
	btnVerifyId: "#Button_DemoCheck_Submit",
	/**
	 * Post-verify controls. Confirmed on live screenshots (2026-07-13):
	 * Verify stays on the same page and reveals a Status panel with
	 * "CONTINUE TO ADD"; Continue opens the "Demo Tracking Sheet" edit page.
	 * ("Request Overage" is still unconfirmed — no overage case seen yet.)
	 */
	btnVerify: "Verify Demo Unit Request",
	btnOverage: "Request Overage",
	btnContinue: "Continue to Add",
	btnSave: "Save",
	btnCancel: "Cancel",
	/**
	 * Final page ("Demo Tracking Sheet") fields — anchored to the exact
	 * labels in Will's live screenshots. labelTracking MUST stay anchored to
	 * "tracking number": the page's title and breadcrumb both contain
	 * "Tracking", and an unanchored /tracking/i landed on the breadcrumb,
	 * which would put the tracking number in the Date of Transfer field.
	 */
	labelNotes: /^notes/i,
	labelUnits: /^units\b/i,
	labelTracking: /^tracking number/i,
	labelFulfilled: /fulfilled/i,
	/** Product option text — exact "MONTAGE" (not "MONTAGE Fast Set") vs Flowable. */
	productMontage: /^montage$/i,
	productFlowable: /montage\s*flowable/i,
};

// ---------------------------------------------------------------------------
// Run bookkeeping (polled by the UI)
// ---------------------------------------------------------------------------

export interface DemoUnitsQuantities {
	montage: number;
	cartridge: number;
	gun: number;
	tips: number;
	hemasorb: number;
	hemasorbApply: number;
	permatage: number;
}

export interface DemoUnitsInput {
	trackingNumber: string;
	repName: string; // "First Last", as written on the shipping sheet
	quantities: DemoUnitsQuantities;
	/**
	 * Dry run: walk every step and fill every field, but STOP right before
	 * clicking Save (and don't write to the real Overage reps sheet), then back
	 * out via Dashboard. Nothing is entered into Kairuku. For safe testing.
	 */
	dryRun?: boolean;
}

export interface RunStep {
	label: string;
	status: "running" | "done" | "failed" | "skipped";
	detail?: string;
}

export interface DemoUnitsRun {
	state: "running" | "completed" | "failed";
	input: DemoUnitsInput;
	steps: RunStep[];
	/** One-line human summary once finished. */
	outcome?: string;
	startedAt: string;
	finishedAt?: string;
	/** Failure screenshot path, when a step failed. */
	screenshot?: string;
	/** Failure page-HTML path (has the real WebForms control IDs). */
	htmlDump?: string;
	/** Copy-pasteable snapshot of the failed page's interactive elements. */
	pageInfo?: string;
	/** Folder holding a screenshot of every completed step of this run. */
	debugDir?: string;
}

let currentRun: DemoUnitsRun | null = null;
let runPage: Page | null = null;
let snapCount = 0;

export function getDemoUnitsRun(): DemoUnitsRun | null {
	return currentRun;
}

/**
 * Photograph the page after every step (best-effort) so a first run can be
 * reviewed screen by screen — if Kairuku's real pages differ from the spec,
 * the shots show exactly where and how.
 */
async function snap(label: string) {
	if (!runPage || !currentRun?.debugDir) return;
	try {
		snapCount += 1;
		const file = `${String(snapCount).padStart(2, "0")}-${label
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.slice(0, 60)}.png`;
		await runPage.screenshot({ path: path.join(currentRun.debugDir, file), fullPage: true });
	} catch {
		// screenshots never break a run
	}
}

function step(label: string): RunStep {
	// Photograph how the previous step left the page before starting the next.
	void snap(currentRun?.steps.at(-1)?.label ?? "start");
	const s: RunStep = { label, status: "running" };
	currentRun?.steps.push(s);
	console.log(`[demo-units] ${label}`);
	return s;
}

// ---------------------------------------------------------------------------
// Page helpers — tolerant lookups so small Kairuku markup differences don't
// break the flow. Text matching is case-insensitive and trimmed throughout.
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

async function clickText(page: Page, text: string) {
	const candidates = [
		page.getByRole("link", { name: text }).first(),
		page.getByRole("button", { name: text }).first(),
		page.getByText(text, { exact: false }).first(),
	];
	for (const c of candidates) {
		if (await c.isVisible().catch(() => false)) {
			await c.click();
			return;
		}
	}
	throw new Error(`Couldn't find anything to click with text "${text}"`);
}

async function textVisible(page: Page, text: string): Promise<boolean> {
	return page
		.getByText(text, { exact: false })
		.first()
		.isVisible()
		.catch(() => false);
}

/**
 * Compact, copy-pasteable snapshot of every interactive element on the page
 * (inputs, selects, buttons, links) with their real IDs/names/labels. Shown
 * in the app on failure so the user can paste it straight into chat — for a
 * WebForms app this is exactly what's needed to write a precise selector,
 * with no file hunting or attachments.
 */
export async function pageFingerprint(page: Page): Promise<string> {
	try {
		return await page.evaluate(() => {
			const clip = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
			const lines: string[] = [];
			lines.push(`URL: ${location.pathname}`);
			lines.push(`TITLE: ${document.title}`);
			const seen = new Set<string>();
			const push = (l: string) => {
				if (l && !seen.has(l)) {
					seen.add(l);
					lines.push(l);
				}
			};
			for (const el of Array.from(document.querySelectorAll("input,select,textarea"))) {
				const e = el as HTMLInputElement;
				if (e.type === "hidden") continue;
				push(
					`${e.tagName.toLowerCase()}` +
						(e.type ? ` type=${e.type}` : "") +
						(e.id ? ` id=${e.id}` : "") +
						(e.name ? ` name=${e.name}` : "") +
						(e.placeholder ? ` ph="${clip(e.placeholder)}"` : "") +
						(e.getAttribute("aria-label") ? ` aria="${clip(e.getAttribute("aria-label"))}"` : ""),
				);
			}
			for (const el of Array.from(document.querySelectorAll("button,a,input[type=submit],input[type=button]")).slice(0, 40)) {
				const e = el as HTMLElement;
				const label = clip(e.innerText || (e as HTMLInputElement).value || "");
				if (!label) continue;
				push(`${e.tagName.toLowerCase()} "${label}"` + (e.id ? ` id=${e.id}` : ""));
			}
			return lines.join("\n");
		});
	} catch {
		return "(couldn't read the page structure)";
	}
}

/** Read a native <select>'s option labels (trimmed, blanks dropped). */
async function optionLabels(select: Locator): Promise<string[]> {
	return (await select.locator("option").allTextContents())
		.map((t) => t.trim())
		.filter(Boolean);
}

/**
 * Walk the distributor dropdown to find the one whose sales-rep dropdown
 * lists this rep — the real-Kairuku equivalent of the spec's "search
 * distributors for the rep". Selecting a distributor triggers an ASP.NET
 * postback that repopulates the rep dropdown, so we select, settle, and read.
 * Returns { distributor, repLabel } on a match, or null if no distributor
 * lists the rep. Skips placeholder options ("-- select --", "All", empty).
 */
async function findDistributorForRep(
	page: Page,
	first: string,
	last: string,
	onProgress: (msg: string) => void,
): Promise<{ distributor: string; repLabel: string } | null> {
	const distSelect = page.locator(SEL.distributorSelect).first();
	await distSelect.waitFor({ state: "visible", timeout: 15_000 });
	// Skip the placeholder ("- Select a Distributor -") but NOT real names that
	// merely contain "select" (e.g. "Smith + Nephew (Select Medical Solutions)").
	const isPlaceholder = (d: string) =>
		d === "" || /^\s*-+\s*$/.test(d) || /^\s*-?\s*(select|choose|please)/i.test(d);
	const dists = (await optionLabels(distSelect)).filter((d) => !isPlaceholder(d));
	onProgress(`checking ${dists.length} distributors…`);
	for (let i = 0; i < dists.length; i++) {
		const d = dists[i];
		try {
			await distSelect.selectOption({ label: d });
			await distSelect.dispatchEvent("change").catch(() => {});
			await settle(page);
			const repSelect = page.locator(SEL.salesRepSelect).first();
			if ((await repSelect.count()) === 0) continue;
			const reps = await optionLabels(repSelect);
			const hit = reps.find((r) => matchesLastFirst(r, first, last));
			if (hit) {
				onProgress(`found under ${d}`);
				return { distributor: d, repLabel: hit };
			}
		} catch {
			// selecting this option failed — move on
		}
		if (i % 10 === 9) onProgress(`checked ${i + 1}/${dists.length}…`);
	}
	return null;
}

/** Find a form control (select/input/textarea) by its label text. */
async function labeledControl(page: Page, label: RegExp, kinds: string): Promise<Locator> {
	// 1) proper <label> association
	const byLabel = page.getByLabel(label).first();
	if ((await byLabel.count()) > 0) return byLabel;
	// 2) control that follows a label-ish element containing the text
	const near = page
		.locator(`xpath=//*[self::label or self::span or self::div or self::th or self::td]`)
		.filter({ hasText: label })
		.first();
	if ((await near.count()) > 0) {
		const following = near.locator(`xpath=following::*[${kinds}][1]`).first();
		if ((await following.count()) > 0) return following;
	}
	throw new Error(`Couldn't find a field labeled ${label}`);
}

const INPUT_KINDS = "self::input or self::textarea";

/**
 * Read a native <select>'s options and pick the one matching `wanted`
 * (exact normalized match first, then contains). Returns the matched option
 * text, or null when it isn't an option — the caller decides what that means.
 */
async function pickOption(
	select: Locator,
	wanted: string | RegExp,
): Promise<string | null> {
	const options: string[] = await select
		.locator("option")
		.allTextContents()
		.then((o) => o.map((t) => t.trim()).filter(Boolean));
	let match: string | undefined;
	if (wanted instanceof RegExp) {
		match = options.find((o) => wanted.test(o));
	} else {
		match =
			options.find((o) => norm(o) === norm(wanted)) ??
			options.find((o) => norm(o).includes(norm(wanted))) ??
			options.find((o) => norm(wanted).includes(norm(o)) && norm(o).length > 3);
	}
	if (!match) return null;
	await select.selectOption({ label: match });
	// Some forms only react to a real change event.
	await select.dispatchEvent("change").catch(() => {});
	return match;
}

/**
 * The Demo Tracking Sheet page has THREE "SAVE" buttons: two small ones
 * inside the "Demo Unit Information" box (Add Individual UID / Add UID
 * Range) and the real one next to CANCEL. Click the one sharing a parent
 * with CANCEL; fall back to the last SAVE on the page (the main SAVE/CANCEL
 * pair renders below the UID box). Never use clickText for this — it takes
 * the FIRST match, which is the Add-Individual-UID save.
 */
async function clickMainSave(page: Page) {
	const cancel = page.getByRole("button", { name: /^cancel$/i }).first();
	if (await cancel.isVisible().catch(() => false)) {
		const paired = cancel
			.locator("xpath=..")
			.getByRole("button", { name: /^save$/i })
			.first();
		if (await paired.isVisible().catch(() => false)) {
			await paired.click();
			return;
		}
	}
	await page.getByRole("button", { name: /^save$/i }).last().click();
}

/**
 * Back out of the Demo Tracking Sheet page without saving. CANCEL is the
 * page's own discard button — prefer it over just navigating away, in case
 * "Continue to Add" opened a draft record that navigation would leave
 * behind (the page presents as an EDIT form, so this is a real risk until
 * confirmed otherwise).
 */
async function cancelOut(page: Page) {
	await page
		.getByRole("button", { name: /^cancel$/i })
		.first()
		.click()
		.catch(() => {});
	await settle(page);
}

async function settle(page: Page) {
	await page.waitForLoadState("domcontentloaded").catch(() => {});
	await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
	await page.waitForTimeout(400);
}

async function goHome(page: Page) {
	await clickText(page, SEL.navDashboard).catch(async () => {
		await page.goto(KAIRUKU_URL, { waitUntil: "domcontentloaded" });
	});
	await settle(page);
}

/** Navigate straight to the Demo Check page (chargesheets.aspx). */
async function gotoDemoPage(page: Page) {
	const url = new URL(SEL.demoPagePath, KAIRUKU_URL).toString();
	await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Name handling: shipping sheet gives "First [Middle] Last"; Kairuku lists
// "Last, First".
// ---------------------------------------------------------------------------

export function splitRepName(repName: string): { first: string; last: string; lastFirst: string } {
	const parts = repName.replace(/\s+/g, " ").trim().split(" ");
	const last = parts[parts.length - 1] ?? "";
	const first = parts.slice(0, -1).join(" ");
	return { first, last, lastFirst: `${last}, ${first}` };
}

function matchesLastFirst(option: string, first: string, last: string): boolean {
	const o = norm(option);
	if (!o.startsWith(`${norm(last)},`)) return false;
	const firstToken = norm(first).split(" ")[0] ?? "";
	return firstToken === "" || o.includes(firstToken);
}

// ---------------------------------------------------------------------------
// Entry math
// ---------------------------------------------------------------------------

export interface DemoEntry {
	product: "MONTAGE" | "MONTAGE FLOWABLE";
	qty: number; // "Demo Units Requested" AND the final page's Units value
	notes: string;
}

export function buildEntries(q: DemoUnitsQuantities): DemoEntry[] {
	const entries: DemoEntry[] = [];
	const montageSum = q.montage + q.permatage + q.hemasorb + q.hemasorbApply;
	if (montageSum > 0) {
		const parts: string[] = [];
		if (q.montage) parts.push(`${q.montage} montage`);
		if (q.permatage) parts.push(`${q.permatage} permatage`);
		if (q.hemasorb) parts.push(`${q.hemasorb} hemasorb`);
		if (q.hemasorbApply) parts.push(`${q.hemasorbApply} hemasorb apply`);
		entries.push({ product: "MONTAGE", qty: montageSum, notes: parts.join(" ") });
	}
	if (q.gun > 0 || q.cartridge > 0 || q.tips > 0) {
		entries.push({
			product: "MONTAGE FLOWABLE",
			qty: q.cartridge,
			notes: `${q.gun} gun, ${q.cartridge} cartridge, ${q.tips} tips`,
		});
	}
	return entries; // MONTAGE first by construction
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function startDemoUnitsRun(input: DemoUnitsInput): Promise<DemoUnitsRun> {
	if (currentRun?.state === "running") {
		throw new Error("A Demo Units run is already in progress.");
	}
	const debugDir = path.join(DEBUG_DIR, `run-${Date.now()}`);
	try {
		mkdirSync(debugDir, { recursive: true });
	} catch {
		// runs fine without step screenshots
	}
	snapCount = 0;
	runPage = null;
	currentRun = {
		state: "running",
		input,
		steps: [],
		startedAt: new Date().toISOString(),
		debugDir,
	};
	// Fire and forget; the UI polls getDemoUnitsRun().
	void run(input).catch(() => {});
	return currentRun;
}

async function finish(outcome: string, state: "completed" | "failed" = "completed") {
	if (!currentRun) return;
	await snap("finish");
	runPage = null;
	currentRun.state = state;
	currentRun.outcome = outcome;
	currentRun.finishedAt = new Date().toISOString();
	console.log(`[demo-units] ${state}: ${outcome}`);
	// The Kairuku window stays open (parked on the Dashboard) — it's the
	// standing logged-in session, ready for the next run.
}

async function run(input: DemoUnitsInput) {
	const { first, last, lastFirst } = splitRepName(input.repName);
	const entries = buildEntries(input.quantities);
	let page: Page;

	let s = step("Check Kairuku session");
	try {
		({ page } = await requireKairukuSession());
		runPage = page;
		s.status = "done";
	} catch (err) {
		s.status = "failed";
		s.detail =
			err instanceof Error && err.message.includes("RELOGIN_REQUIRED")
				? "Kairuku session isn't live — open the Kairuku Session tab and log in first."
				: err instanceof Error
					? err.message
					: "unknown error";
		await finish(s.detail, "failed");
		return;
	}

	try {
		if (entries.length === 0) {
			await finish("No quantities entered — nothing to submit.", "failed");
			return;
		}

		// ── Open the Demo Check page (UID Tracking → chargesheets.aspx) ───────
		s = step("Open UID Tracking (Demo Units)");
		await gotoDemoPage(page);
		await settle(page);
		if ((await page.locator(SEL.distributorSelect).count()) === 0) {
			throw new Error(
				"Couldn't find the Demo Check distributor dropdown on the UID Tracking page.",
			);
		}
		s.status = "done";

		// ── Part 1: find the rep's distributor by walking the ~24 demo-eligible
		// distributors and checking each one's sales-rep dropdown. If the rep
		// isn't under any of them, their distributor isn't demo-eligible →
		// task complete (the spec's "not in the dropdown → skip" rule). ──────
		s = step(`Find distributor for ${lastFirst}`);
		const match = await findDistributorForRep(page, first, last, (m) => {
			s.detail = m;
		});
		if (!match) {
			if (!input.dryRun) addOverageRow(input.repName, "NOT IN k.");
			s.status = "done";
			s.detail = `${lastFirst} not under any demo-eligible distributor`;
			await goHome(page);
			await finish(
				`${input.repName}'s distributor isn't in the Demo Units list — no entry needed. Task complete.`,
			);
			return;
		}
		const distributor = match.distributor;
		const foundRepLabel = match.repLabel;
		s.status = "done";
		s.detail = `Distributor: ${distributor} · Rep: ${foundRepLabel}`;

		// ── Parts 2–4, once per entry ─────────────────────────────────────────
		const saved: string[] = [];
		const overages: string[] = [];
		for (const entry of entries) {
			s = step(`${entry.product}: select distributor + rep`);
			// Fresh page per entry so each starts from a clean Demo Check form.
			await gotoDemoPage(page);
			await settle(page);
			const distSelect = page.locator(SEL.distributorSelect).first();
			const distMatch = await pickOption(distSelect, distributor);
			if (!distMatch) {
				throw new Error(`"${distributor}" vanished from the demo distributor dropdown`);
			}
			await settle(page); // AJAX repopulates the sales-rep dropdown

			const repSelect = page.locator(SEL.salesRepSelect).first();
			const repOptions = (await repSelect.locator("option").allTextContents()).map((o) =>
				o.trim(),
			);
			const repMatch =
				repOptions.find((o) => o === foundRepLabel) ??
				repOptions.find((o) => matchesLastFirst(o, first, last));
			if (!repMatch) throw new Error(`${lastFirst} isn't in the rep dropdown for ${distMatch}`);
			await repSelect.selectOption({ label: repMatch });
			await repSelect.dispatchEvent("change").catch(() => {});
			await settle(page);
			s.status = "done";
			s.detail = `${distMatch} · ${repMatch}`;

			s = step(`${entry.product}: product + ${entry.qty} requested → verify`);
			const productSelect = page.locator(SEL.productSelect).first();
			const wantedProduct =
				entry.product === "MONTAGE" ? SEL.productMontage : SEL.productFlowable;
			if (!(await pickOption(productSelect, wantedProduct))) {
				throw new Error(`No product option matching ${entry.product}`);
			}
			await productSelect.dispatchEvent("change").catch(() => {});
			await settle(page);
			await page.locator(SEL.qtyInput).first().fill(String(entry.qty));
			await page.locator(SEL.btnVerifyId).first().click();
			await settle(page);
			s.status = "done";

			// ── Part 3: overage vs continue ──
			if (await textVisible(page, SEL.btnOverage)) {
				if (!input.dryRun) addOverageRow(input.repName, entry.product.toLowerCase());
				s = step(`${entry.product}: overage — logged, skipping this entry`);
				s.status = "done";
				overages.push(entry.product);
				await goHome(page); // never click Request Overage
				continue;
			}
			await clickText(page, SEL.btnContinue);
			await settle(page);

			// ── Part 4: final page ──
			s = step(`${entry.product}: notes, units, tracking, fulfilled → save`);
			const notes = await labeledControl(page, SEL.labelNotes, INPUT_KINDS);
			await notes.fill(entry.notes);
			const units = await labeledControl(page, SEL.labelUnits, INPUT_KINDS);
			await units.fill(String(entry.qty)); // overwrite whatever was prefilled
			const tracking = await labeledControl(page, SEL.labelTracking, INPUT_KINDS);
			await tracking.fill(input.trackingNumber);
			const labeledBox = page.getByLabel(SEL.labelFulfilled).first();
			if (await labeledBox.isVisible().catch(() => false)) {
				await labeledBox.check();
			} else {
				// Fall back to the page's first checkbox (the form has one).
				await page.getByRole("checkbox").first().check();
			}
			if (input.dryRun) {
				await snap(`${entry.product}-dry-run-final-form`);
				s.status = "done";
				s.detail = "DRY RUN — every field filled, stopped before Save";
				saved.push(`${entry.product} (${entry.qty}) — dry run, NOT saved`);
				await cancelOut(page); // discard via the page's own CANCEL, then home
				await goHome(page);
				continue;
			}
			await clickMainSave(page);
			await settle(page);
			saved.push(`${entry.product} (${entry.qty})`);
			s.status = "done";
		}

		const bits: string[] = [];
		if (input.dryRun) bits.push("DRY RUN — nothing was saved into Kairuku");
		if (saved.length) bits.push(`${input.dryRun ? "Walked through" : "Saved"}: ${saved.join(" and ")}`);
		if (overages.length)
			bits.push(
				`Overage ${input.dryRun ? "detected (dry run — not logged)" : "logged"} for: ${overages.join(" and ")}`,
			);
		await goHome(page);
		await finish(`${bits.join(". ")}. Tracking ${input.trackingNumber} for ${input.repName}.`);
	} catch (err) {
		const msg = err instanceof Error ? err.message.split("\n")[0] : "unknown error";
		const running = currentRun?.steps.find((x) => x.status === "running");
		if (running) {
			running.status = "failed";
			running.detail = msg;
		}
		// Failure screenshot AND page HTML for selector tuning. Kairuku is an
		// ASP.NET WebForms app, so the HTML carries the exact control IDs — the
		// single most useful thing to hand Claude to write a precise selector.
		// Long __VIEWSTATE/__EVENTVALIDATION tokens are redacted (huge + useless
		// for selectors); everything structural is kept.
		try {
			if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });
			const stamp = Date.now();
			const shot = path.join(DEBUG_DIR, `demo-units-failure-${stamp}.png`);
			await page!.screenshot({ path: shot, fullPage: true });
			if (currentRun) currentRun.screenshot = shot;
			const htmlPath = path.join(DEBUG_DIR, `demo-units-failure-${stamp}.html`);
			const html = (await page!.content())
				.replace(/(__VIEWSTATE\w*"\s+value=")[^"]*/g, "$1[redacted]")
				.replace(/(__EVENTVALIDATION"\s+value=")[^"]*/g, "$1[redacted]");
			writeFileSync(htmlPath, html);
			if (currentRun) {
				currentRun.htmlDump = htmlPath;
				// Copy-pasteable page structure — the fast path for the user.
				currentRun.pageInfo = await pageFingerprint(page!);
			}
		} catch {
			// best-effort
		}
		// If the failure happened on the Demo Tracking Sheet page, discard the
		// draft via CANCEL before leaving (harmless no-op on any other page).
		await cancelOut(page!).catch(() => {});
		await goHome(page!).catch(() => {});
		await finish(`Stopped at a step that didn't match the page: ${msg}`, "failed");
	}
}
