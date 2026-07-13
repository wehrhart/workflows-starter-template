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

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { requireKairukuSession, KAIRUKU_URL } from "./kairukuSessionManager.ts";
import { addOverageRow, KAIRUKU_DATA_DIR } from "./overageSheet.ts";

const DEBUG_DIR = path.join(KAIRUKU_DATA_DIR, "debug");

const SEL = {
	/** Top-nav links (matched by their visible text). */
	navDistributors: "Distributors",
	navDashboard: "Dashboard",
	navUidTracking: "UID Tracking",
	navDemoUnits: "Demo Units",
	navProfessionals: "Professionals",
	/** Distributors page search box (first match wins). */
	distributorSearch:
		'input[type="search"], input[placeholder*="earch"], input[name*="search" i]',
	/** Demo Units form fields, found by their label text (regex). */
	labelDistributor: /distributor/i,
	labelSalesRep: /sales\s*rep/i,
	labelProduct: /product/i,
	labelDemoUnitsRequested: /demo\s*units\s*requested/i,
	/** Buttons on the Demo Units flow. */
	btnVerify: "Verify Demo Unit Request",
	btnOverage: "Request Overage",
	btnContinue: "Continue to Add",
	btnSave: "Save",
	/** Final page fields. */
	labelNotes: /note/i,
	labelUnits: /^units/i,
	labelTracking: /tracking/i,
	labelFulfilled: /fulfilled/i,
	/** Product option text in the product dropdown. */
	productMontage: /^montage(?!.*flow)/i,
	productFlowable: /flowable/i,
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
 * Type into a search/text box, tolerantly. The real Kairuku search field may
 * be a plain text input, a search input, a role=searchbox, or wrapped so its
 * placeholder/name differ from the guess — so try the configured selector
 * first, then fall back to the first visible text-like input on the page.
 * Types character-by-character (some search widgets ignore a bulk fill) and
 * submits with Enter.
 */
async function fillSearch(page: Page, value: string): Promise<boolean> {
	const selectors = [
		SEL.distributorSearch,
		'input[type="search"]',
		'[role="searchbox"]',
		'input[placeholder*="search" i]',
		'input[aria-label*="search" i]',
		'input[name*="search" i]',
		'input[id*="search" i]',
		'input[type="text"]',
		"input:not([type])",
		'input[type="email"]',
		'[contenteditable="true"]',
	];
	for (const sel of selectors) {
		const box = page.locator(sel).first();
		try {
			await box.waitFor({ state: "visible", timeout: 2_500 });
		} catch {
			continue;
		}
		try {
			await box.click({ timeout: 2_000 });
			await box.fill("").catch(() => {});
			await box.pressSequentially(value, { delay: 40 });
			await box.press("Enter").catch(() => {});
			return true;
		} catch {
			// try the next selector
		}
	}
	return false;
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

const SELECT_KINDS = "self::select";
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Last, First" appearing anywhere in a blob of page text. */
function lastFirstInText(text: string, first: string, last: string): boolean {
	const firstToken = norm(first).split(" ")[0] ?? "";
	return new RegExp(`${escapeRe(last)}\\s*,\\s*${escapeRe(firstToken)}`, "i").test(text);
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

		// ── Part 1: find the rep's distributor ────────────────────────────────
		s = step(`Find distributor for ${lastFirst}`);
		await goHome(page);
		await clickText(page, SEL.navDistributors);
		await settle(page);
		if (!(await fillSearch(page, last))) {
			throw new Error(
				"Couldn't find the Distributors search box — send the failure screenshot so the selector can be set to the real one.",
			);
		}
		await settle(page);

		// Result rows: links that aren't the top-nav items.
		const NAV_TEXTS = [
			SEL.navDistributors,
			SEL.navDashboard,
			SEL.navUidTracking,
			SEL.navDemoUnits,
		].map(norm);
		const readResults = async (): Promise<string[]> => {
			const texts = await page
				.locator("main a, table a, [role=main] a, a")
				.allTextContents();
			return [...new Set(texts.map((t) => t.trim()))].filter(
				(t) => t.length > 1 && !NAV_TEXTS.includes(norm(t)),
			);
		};
		const results = await readResults();

		let distributor: string | null = null;
		if (results.length === 0) {
			if (!input.dryRun) addOverageRow(input.repName, "NOT IN k.");
			s.status = "done";
			s.detail = `No Distributors search results for "${last}"`;
			await goHome(page);
			await finish(
				`${input.repName} not found in Kairuku — ${
					input.dryRun
						? 'DRY RUN: would be logged as "NOT IN k."'
						: 'logged on the Overage reps sheet as "NOT IN k."'
				}. No entry made.`,
			);
			return;
		}
		if (results.length === 1) {
			distributor = results[0];
		} else {
			// Open each candidate → Professionals → look for "Last, First".
			for (const candidate of results) {
				await clickText(page, candidate);
				await settle(page);
				await clickText(page, SEL.navProfessionals).catch(() => {});
				await settle(page);
				const people = (await page.locator("main, body").first().textContent()) ?? "";
				const found = lastFirstInText(people, first, last);
				// Back to the search results for the next candidate either way.
				await page.goBack().catch(() => {});
				await settle(page);
				if (found) {
					distributor = candidate;
					break;
				}
				await page.goBack().catch(() => {});
				await settle(page);
			}
			if (!distributor) {
				if (!input.dryRun) addOverageRow(input.repName, "NOT IN k.");
				s.status = "done";
				s.detail = `${results.length} distributors matched "${last}" but none listed ${lastFirst}`;
				await goHome(page);
				await finish(
					`${input.repName} not found under any distributor — logged as "NOT IN k.". No entry made.`,
				);
				return;
			}
		}
		s.status = "done";
		s.detail = `Distributor: ${distributor}`;

		// ── Parts 2–4, once per entry ─────────────────────────────────────────
		const saved: string[] = [];
		const overages: string[] = [];
		for (const entry of entries) {
			s = step(`${entry.product}: open Demo Units`);
			await goHome(page);
			await clickText(page, SEL.navUidTracking);
			await settle(page);
			await clickText(page, SEL.navDemoUnits);
			await settle(page);
			s.status = "done";

			s = step(`${entry.product}: select distributor`);
			const distSelect = await labeledControl(page, SEL.labelDistributor, SELECT_KINDS);
			const distMatch = await pickOption(distSelect, distributor);
			if (!distMatch) {
				s.status = "done";
				s.detail = `"${distributor}" isn't an option in the Demo Units distributor dropdown`;
				await goHome(page);
				await finish(
					`${distributor} isn't in the Demo Units dropdown — no entry needed. Task complete.`,
				);
				return;
			}
			await settle(page); // page reloads and the sales-rep dropdown fills in
			s.status = "done";
			s.detail = distMatch;

			s = step(`${entry.product}: select sales rep ${lastFirst}`);
			const repSelect = await labeledControl(page, SEL.labelSalesRep, SELECT_KINDS);
			const repOptions = await repSelect.locator("option").allTextContents();
			const repMatch = repOptions.map((o) => o.trim()).find((o) => matchesLastFirst(o, first, last));
			if (!repMatch) {
				throw new Error(
					`${lastFirst} isn't in the sales rep dropdown for ${distMatch}`,
				);
			}
			await repSelect.selectOption({ label: repMatch });
			await repSelect.dispatchEvent("change").catch(() => {});
			await settle(page);
			s.status = "done";
			s.detail = repMatch;

			s = step(`${entry.product}: product + ${entry.qty} requested → verify`);
			const productSelect = await labeledControl(page, SEL.labelProduct, SELECT_KINDS);
			const wantedProduct =
				entry.product === "MONTAGE" ? SEL.productMontage : SEL.productFlowable;
			if (!(await pickOption(productSelect, wantedProduct))) {
				throw new Error(`No product option matching ${entry.product}`);
			}
			const qtyInput = await labeledControl(page, SEL.labelDemoUnitsRequested, INPUT_KINDS);
			await qtyInput.fill(String(entry.qty));
			await clickText(page, SEL.btnVerify);
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
				await goHome(page); // backs out; nothing is half-entered (Dashboard resets the form)
				continue;
			}
			await clickText(page, SEL.btnSave);
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
		// Failure screenshot for selector tuning; path is surfaced in the UI.
		try {
			if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });
			const shot = path.join(DEBUG_DIR, `demo-units-failure-${Date.now()}.png`);
			await page!.screenshot({ path: shot, fullPage: true });
			if (currentRun) currentRun.screenshot = shot;
		} catch {
			// screenshot is best-effort
		}
		await goHome(page!).catch(() => {});
		await finish(`Stopped at a step that didn't match the page: ${msg}`, "failed");
	}
}
