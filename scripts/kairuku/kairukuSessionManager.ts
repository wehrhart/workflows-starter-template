/**
 * Kairuku Session Manager — the shared login/session foundation for every
 * future Kairuku tool in Abyrx Tools.
 *
 * What it does
 *   • Opens a real (headed) Chromium window at the Kairuku login page so YOU
 *     type your username / password / MFA code by hand. Nothing is captured.
 *   • Uses a Playwright *persistent* browser profile (a local folder) so the
 *     logged-in cookies survive between runs — log in once, reuse everywhere.
 *   • Watches the window until it detects you are authenticated, then closes
 *     the window automatically.
 *   • Lets future tools call `requireKairukuSession()` to get an
 *     authenticated Playwright page, or a clear RELOGIN_REQUIRED error.
 *
 * What it never does
 *   • It never reads, stores, or logs your username, password, MFA code,
 *     cookies, tokens, or session storage. The only thing persisted is the
 *     browser's own profile directory (gitignored), exactly as if you had
 *     logged into Chrome yourself.
 *   • It never submits, edits, downloads, or scrapes Kairuku data. It only
 *     authenticates and hands a logged-in page to future tools.
 *
 * Runs under plain Node (not the Cloudflare worker):
 *   node --experimental-strip-types scripts/kairuku/kairuku-session-server.ts
 */

import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** The Kairuku login URL (env-overridable for testing against a mock). */
export const KAIRUKU_URL = process.env.KAIRUKU_URL ?? "https://beta.kairuku.com/";

/**
 * Where the persistent browser profile lives (cookies, local storage — the
 * browser's own encrypted-at-rest state). Kept in the user's HOME directory,
 * not the tools folder, so replacing the folder with a fresh download never
 * logs Kairuku out. Never committed anywhere.
 */
export const KAIRUKU_PROFILE_DIR = path.resolve(
	process.env.KAIRUKU_PROFILE_DIR ??
		path.join(os.homedir(), ".abyrx-kairuku", "browser-profile"),
);

/**
 * ── UPDATE ME AFTER YOUR FIRST REAL LOGIN ─────────────────────────────────
 * A CSS selector for something that ONLY exists once you are logged in to
 * Kairuku — an account/avatar menu, a dashboard heading, a "Log out" button,
 * a nav bar, etc.
 *
 * How to find it: log in once, right-click a clearly logged-in-only element
 * → Inspect, and copy a stable selector. Examples of the kind of thing that
 * works well:
 *   '[data-testid="account-menu"]'
 *   'nav a[href*="logout"]'
 *   'button:has-text("Log out")'
 *
 * While this is left empty (""), a conservative heuristic is used instead
 * (see `isAuthenticated` below): "no login/MFA form visible and not on an
 * auth-looking URL". The heuristic is decent but the selector is better —
 * set it as soon as you've logged in once and can inspect the page.
 * Can also be set without code changes via the KAIRUKU_LOGGED_IN_SELECTOR
 * environment variable.
 */
export const KAIRUKU_LOGGED_IN_SELECTOR =
	process.env.KAIRUKU_LOGGED_IN_SELECTOR ?? "";

/** URL fragments that indicate we are still on a login / MFA / auth screen. */
const AUTH_URL_HINTS =
	/log[-_]?in|sign[-_]?in|auth|mfa|two[-_]?factor|2fa|otp|verify|challenge|passwor/i;

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type KairukuStatus =
	| "not_connected" // no session known (fresh profile, or window closed before login)
	| "login_window_open" // headed window is open, waiting for you to log in
	| "checking" // actively verifying the stored session
	| "live" // authenticated — future tools may use the session
	| "relogin_required"; // stored session exists but is expired / logged out

export interface KairukuStatusReport {
	status: KairukuStatus;
	/** Human-readable one-liner for the UI. Never contains secrets. */
	detail: string;
	updatedAt: string;
}

/** Thrown by requireKairukuSession() when the stored session is not usable. */
export class KairukuReloginRequiredError extends Error {
	code = "RELOGIN_REQUIRED";
	constructor(detail?: string) {
		super(
			`RELOGIN_REQUIRED: Kairuku session is not live${detail ? ` (${detail})` : ""}. ` +
				"Open the Kairuku Session tab in Abyrx Tools and log in again.",
		);
		this.name = "KairukuReloginRequiredError";
	}
}

let status: KairukuStatus = "not_connected";
let detail = "No Kairuku session yet.";
let updatedAt = new Date().toISOString();

/**
 * The one live browser context. A persistent profile can only be opened by a
 * single browser at a time, so everything funnels through this singleton.
 * mode: "login" = headed window the user is typing into;
 *       "session" = background context handed to tools.
 */
let activeContext: BrowserContext | null = null;
let activeMode: "login" | "session" | null = null;

function setStatus(next: KairukuStatus, nextDetail: string) {
	status = next;
	detail = nextDetail;
	updatedAt = new Date().toISOString();
	// Log status transitions only — never cookies, tokens, or form values.
	console.log(`[kairuku] status → ${next}: ${nextDetail}`);
}

export function getKairukuStatus(): KairukuStatusReport {
	return { status, detail, updatedAt };
}

/**
 * The current page of the standing Kairuku window (login OR session), without
 * navigating or verifying anything. Lets a tool inspect whatever screen the
 * user has that window on right now. Null if no window is open.
 */
export function getStandingPage(): Page | null {
	if (activeContext) return currentPage(activeContext);
	return null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function launchPersistent(headless: boolean): Promise<BrowserContext> {
	try {
		return await chromium.launchPersistentContext(KAIRUKU_PROFILE_DIR, {
			headless,
			// Natural window size for a login the user drives by hand.
			viewport: null,
			// Headless checks must NOT advertise themselves as a bot: the old
			// headless shell's user agent says "HeadlessChrome", which some
			// sites answer with the login page even for a valid session. The
			// "chromium" channel runs the regular Chromium binary in new
			// headless mode, whose user agent is normal Chrome.
			...(headless && !process.env.KAIRUKU_CHROMIUM_PATH
				? { channel: "chromium" as const }
				: {}),
			// Normally Playwright finds its own Chromium; set this env var only
			// if you need to point at a specific Chromium/Chrome binary.
			executablePath: process.env.KAIRUKU_CHROMIUM_PATH || undefined,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/executable doesn't exist|browserType.launch/i.test(msg)) {
			throw new Error(
				"Playwright's Chromium isn't installed. Run `npx playwright install chromium` once, then try again.",
			);
		}
		throw err;
	}
}

/**
 * Fresh headless loads can bounce through sign-in redirects before landing
 * on the logged-in app, so a single instant check reports false logouts.
 * Poll for up to ~18s before concluding the session is dead.
 */
async function waitForAuthenticated(page: Page): Promise<boolean> {
	for (let i = 0; i < 6; i++) {
		if (await isAuthenticated(page)) return true;
		await sleep(3_000);
	}
	return false;
}

/**
 * When a headless check concludes "not logged in", capture what it actually
 * saw — the page URL (query redacted; it can hold tokens) and a screenshot —
 * so a wrong conclusion can be diagnosed instead of guessed at.
 */
async function describeCheckFailure(page: Page): Promise<string> {
	try {
		const debugDir = path.join(os.homedir(), ".abyrx-kairuku", "data", "debug");
		mkdirSync(debugDir, { recursive: true });
		const shot = path.join(debugDir, `session-check-${Date.now()}.png`);
		await page.screenshot({ path: shot }).catch(() => {});
		const u = new URL(page.url());
		return `the check saw ${u.origin}${u.pathname} (screenshot: ${shot})`;
	} catch {
		return "the check couldn't read the page";
	}
}

async function closeActiveContext() {
	const ctx = activeContext;
	activeContext = null;
	activeMode = null;
	if (ctx) {
		try {
			await ctx.close();
		} catch {
			// already closed (e.g. the user closed the window) — fine
		}
	}
}

/** The most recently opened page in the context (login flows may open tabs). */
function currentPage(ctx: BrowserContext): Page | null {
	const pages = ctx.pages();
	return pages.length ? pages[pages.length - 1] : null;
}

/**
 * Decide whether a page shows a logged-in Kairuku.
 *
 * Preferred: the KAIRUKU_LOGGED_IN_SELECTOR above — set it after your first
 * login. Fallback heuristic (used while the selector is empty):
 *   1. the URL must not look like a login/MFA/auth screen, and
 *   2. no password field or one-time-code input may be visible.
 * Both checks must pass. This errs on the side of "not logged in", so the
 * login window stays open through every login + MFA screen and only closes
 * once you land somewhere that no longer asks for credentials.
 */
async function isAuthenticated(page: Page): Promise<boolean> {
	try {
		await page
			.waitForLoadState("domcontentloaded", { timeout: 5_000 })
			.catch(() => {});

		if (KAIRUKU_LOGGED_IN_SELECTOR) {
			return (
				(await page
					.locator(KAIRUKU_LOGGED_IN_SELECTOR)
					.first()
					.isVisible()
					.catch(() => false)) === true
			);
		}

		// ── Kairuku's REAL login markers (confirmed from beta.kairuku.com) ──
		// It's an ASP.NET WebForms app: the login page has id="Username" and
		// id="Password" and the title "KAIRUKU - Administration". If either
		// credential field is present, we are NOT logged in — the single most
		// reliable signal, and what keeps the window open through login + MFA.
		const loginField = page
			.locator("#Username, #Password")
			.first();
		if (await loginField.isVisible().catch(() => false)) return false;

		// ── Generic heuristic fallback ──
		const url = page.url();
		if (!url.startsWith("http")) return false;
		if (AUTH_URL_HINTS.test(url)) return false;

		// Any credential-ish input visible → still logging in. Cast a wide net:
		// Kairuku's 6-digit screen (like many) uses plain text/tel boxes, so also
		// match short-maxlength digit inputs and anything named/id'd like a code.
		const authField = page
			.locator(
				[
					'input[type="password"]',
					'input[autocomplete="one-time-code"]',
					'input[name*="otp" i], input[id*="otp" i]',
					'input[name*="code" i], input[id*="code" i], input[placeholder*="code" i]',
					'input[name*="token" i], input[id*="token" i]',
					'input[inputmode="numeric"][maxlength]',
					'input[type="tel"][maxlength]',
					'input[maxlength="1"], input[maxlength="4"], input[maxlength="6"], input[maxlength="8"]',
				].join(", "),
			)
			.first();
		if (await authField.isVisible().catch(() => false)) return false;

		// MFA/verification screens say so in words even when their inputs look
		// generic — if the page is talking about codes, we are NOT logged in.
		const bodyText = await page
			.locator("body")
			.innerText({ timeout: 3_000 })
			.catch(() => "");
		if (
			/verification code|security code|one[\s-]?time (code|passcode|password)|\b\d[\s-]?digit code\b|enter (the |your )?code|code (was |we )?(sent|texted)|sent (you )?a (code|text)|two[\s-]?step|authenticator|remember this (device|browser)/i.test(
				bodyText,
			)
		) {
			return false;
		}

		// Require a real, rendered page (not blank/error) before declaring live.
		const hasContent = await page
			.locator("body *")
			.first()
			.isVisible()
			.catch(() => false);
		return hasContent;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Public API — reusable by every future Kairuku tool
// ---------------------------------------------------------------------------

/**
 * Open a real, headed Chromium window at the Kairuku login page using the
 * persistent profile. The user logs in (including MFA) by hand; a watcher
 * polls until the page looks authenticated, then closes the window
 * automatically and marks the session live. Returns as soon as the window is
 * open — watch getKairukuStatus() for progress.
 */
export async function openKairukuLoginWindow(): Promise<KairukuStatusReport> {
	if (activeMode === "login") {
		setStatus("login_window_open", "Login window is already open.");
		return getKairukuStatus();
	}
	// A background session context would hold the profile lock — release it.
	if (activeMode === "session") await closeActiveContext();

	setStatus("checking", "Opening the Kairuku login window…");
	let ctx: BrowserContext;
	try {
		ctx = await launchPersistent(false);
	} catch (err) {
		setStatus("not_connected", "Could not open the login window.");
		throw err;
	}
	activeContext = ctx;
	activeMode = "login";

	const page = currentPage(ctx) ?? (await ctx.newPage());
	await page.goto(KAIRUKU_URL, { waitUntil: "domcontentloaded" }).catch(() => {
		// Keep the window open even if the first load hiccups — the user can
		// retry/navigate; the watcher keeps checking whatever is on screen.
	});
	setStatus(
		"login_window_open",
		"Login window open — log in and enter your MFA code in the browser window.",
	);

	// If the user closes the window themselves, reflect that.
	ctx.on("close", () => {
		if (activeContext === ctx) {
			const wasSession = activeMode === "session";
			activeContext = null;
			activeMode = null;
			if (wasSession) {
				// The user closed the standing window — the saved profile keeps
				// the login, and tools reopen a window when they need one.
				setStatus(
					"live",
					"Kairuku window closed — your login is saved. A window reopens automatically when a tool needs it.",
				);
			} else if (status === "login_window_open" || status === "checking") {
				setStatus(
					"not_connected",
					"Login window was closed before login was detected.",
				);
			}
		}
	});

	// Watcher: poll until authenticated, then close the window.
	void (async () => {
		while (activeContext === ctx && activeMode === "login") {
			await sleep(2_000);
			if (activeContext !== ctx) return;
			const p = currentPage(ctx);
			if (!p) continue;
			if (await isAuthenticated(p)) {
				setStatus("checking", "Login detected — confirming…");
				// Confirm the logged-in state HOLDS (two more checks, 4s apart) —
				// a brief between-screens moment must not count as logged in
				// while the user is mid-login/MFA.
				await sleep(4_000);
				const midPage = currentPage(ctx);
				const midOk =
					activeContext === ctx && midPage && (await isAuthenticated(midPage));
				await sleep(4_000);
				const confirmPage = currentPage(ctx);
				if (
					midOk &&
					activeContext === ctx &&
					confirmPage &&
					(await isAuthenticated(confirmPage))
				) {
					// KEEP THE WINDOW OPEN. This very window is the logged-in
					// session — tools drive it directly, which sidesteps every
					// headless/bot-detection problem. It becomes the standing
					// session window; the user can minimize it.
					activeMode = "session";
					setStatus(
						"live",
						"Kairuku is live — keeping the browser window open in the background for the tools to use. Minimize it if it's in the way (don't close it).",
					);
					return;
				}
				if (activeContext === ctx) {
					setStatus(
						"login_window_open",
						"Still finishing login — window stays open.",
					);
				}
			}
		}
	})();

	return getKairukuStatus();
}

/**
 * Verify the stored session by opening the profile headlessly, loading
 * Kairuku, and running the login check. Safe to call any time (no-op while
 * the login window is open). Read-only: it loads the page and looks at it —
 * nothing is clicked, submitted, or scraped.
 */
export async function checkKairukuSessionStatus(): Promise<KairukuStatusReport> {
	if (activeMode === "login") return getKairukuStatus();

	if (activeMode === "session" && activeContext) {
		// The standing window is open — it was verified when it was opened,
		// and poking at its page could disturb a tool run in progress.
		setStatus("live", "Kairuku is live (browser window open in the background).");
		return getKairukuStatus();
	}

	if (!existsSync(KAIRUKU_PROFILE_DIR)) {
		setStatus("not_connected", "No saved Kairuku session yet — log in first.");
		return getKairukuStatus();
	}

	setStatus("checking", "Checking the saved Kairuku session…");
	// Open a VISIBLE window (never headless — some sites bounce headless
	// browsers to login even with a valid session). If the session is live,
	// the window STAYS OPEN as the standing session window for the tools.
	let ctx: BrowserContext | null = null;
	try {
		ctx = await launchPersistent(false);
		const page = currentPage(ctx) ?? (await ctx.newPage());
		await page.goto(KAIRUKU_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
		if (await waitForAuthenticated(page)) {
			activeContext = ctx;
			activeMode = "session";
			const kept = ctx;
			ctx.on("close", () => {
				if (activeContext === kept) {
					activeContext = null;
					activeMode = null;
					setStatus(
						"live",
						"Kairuku window closed — your login is saved. A window reopens automatically when a tool needs it.",
					);
				}
			});
			ctx = null; // don't close it in finally
			setStatus(
				"live",
				"Kairuku is live — keeping a browser window open in the background for the tools. Minimize it if it's in the way.",
			);
		} else {
			setStatus(
				"relogin_required",
				`Couldn't confirm the saved session — ${await describeCheckFailure(page)}. If you just logged in, try Check Session Status once more.`,
			);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : "unknown error";
		setStatus("relogin_required", `Could not verify the session: ${msg}`);
	} finally {
		if (ctx) await ctx.close().catch(() => {});
	}
	return getKairukuStatus();
}

/**
 * Get an authenticated Playwright page backed by the persistent profile.
 * Opens (or reuses) a background context, verifies login, and returns
 * { context, page }. Throws KairukuReloginRequiredError if not authenticated.
 * The context stays open for the caller; call closeKairukuBrowser() when done.
 */
export async function getKairukuAuthenticatedPage(): Promise<{
	context: BrowserContext;
	page: Page;
}> {
	if (activeMode === "login") {
		throw new Error(
			"The Kairuku login window is open — finish logging in (or close it) first.",
		);
	}

	if (activeMode === "session" && activeContext) {
		// Reuse the standing window AS-IS. It was already confirmed logged-in
		// when it was opened, so DON'T re-navigate it or re-run the login
		// heuristic here — that heuristic doesn't know Kairuku's real
		// logged-in page and was wrongly closing a perfectly good window.
		// The caller (e.g. the Demo Units runner) navigates from here itself;
		// if the session really is dead, it fails at a real step and
		// screenshots it — far more useful than a false "expired".
		const p = currentPage(activeContext) ?? (await activeContext.newPage());
		setStatus("live", "Kairuku is live (reusing the open browser window).");
		return { context: activeContext, page: p };
	}

	if (!existsSync(KAIRUKU_PROFILE_DIR)) {
		setStatus("not_connected", "No saved Kairuku session yet — log in first.");
		throw new KairukuReloginRequiredError("no saved session");
	}

	setStatus("checking", "Opening the saved Kairuku session…");
	// VISIBLE window — it becomes the standing session window (and the user
	// gets to watch the tools work in it).
	let ctx: BrowserContext;
	try {
		ctx = await launchPersistent(false);
	} catch (err) {
		setStatus("not_connected", "Could not open the saved session.");
		throw err;
	}
	activeContext = ctx;
	activeMode = "session";
	ctx.on("close", () => {
		if (activeContext === ctx) {
			activeContext = null;
			activeMode = null;
		}
	});

	const page = currentPage(ctx) ?? (await ctx.newPage());
	try {
		await page.goto(KAIRUKU_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
	} catch {
		await closeActiveContext();
		setStatus("relogin_required", "Could not reach Kairuku to verify the session.");
		throw new KairukuReloginRequiredError("could not reach Kairuku");
	}
	if (!(await waitForAuthenticated(page))) {
		const seen = await describeCheckFailure(page);
		await closeActiveContext();
		setStatus("relogin_required", `Couldn't confirm the session — ${seen}.`);
		throw new KairukuReloginRequiredError("session expired");
	}
	setStatus("live", "Kairuku session is live and ready.");
	return { context: ctx, page };
}

/**
 * The one call every future Kairuku tool should make before doing anything:
 *
 *   const { page } = await requireKairukuSession();
 *
 * Returns an authenticated { context, page } when the session is live;
 * throws KairukuReloginRequiredError (err.code === "RELOGIN_REQUIRED") when
 * it isn't — catch it and send the user to the Kairuku Session tab.
 */
export async function requireKairukuSession(): Promise<{
	context: BrowserContext;
	page: Page;
}> {
	return getKairukuAuthenticatedPage();
}

/**
 * Close whatever Kairuku browser is open (the login window or a background
 * session context). The saved profile on disk is untouched, so a live
 * session stays live.
 */
export async function closeKairukuBrowser(): Promise<KairukuStatusReport> {
	const wasLogin = activeMode === "login";
	const hadContext = activeContext !== null;
	await closeActiveContext();
	if (wasLogin) {
		setStatus("not_connected", "Login window closed manually.");
	} else if (hadContext && status === "live") {
		setStatus("live", "Session browser closed — saved session is still live.");
	}
	return getKairukuStatus();
}
