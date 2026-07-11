import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Kairuku Session tool — the login/session foundation for future Kairuku
 * tools. This tab drives a small local service (`npm run kairuku:session`)
 * that opens a real Chromium window at the Kairuku login page, watches for a
 * successful login (you type your password and MFA code yourself — nothing is
 * captured), closes the window automatically, and keeps the session in a
 * persistent local browser profile that future tools reuse via
 * requireKairukuSession().
 */

/**
 * Where the local Kairuku session service listens. It's started with
 * `npm run kairuku:session` and binds to 127.0.0.1 only. Override the port
 * there via KAIRUKU_SESSION_PORT and here to match.
 */
const SERVICE_URL = "http://127.0.0.1:5281";

const KAIRUKU_URL = "https://beta.kairuku.com/";

type ServiceStatus =
	| "offline" // the local session service isn't running
	| "not_connected"
	| "login_window_open"
	| "checking"
	| "live"
	| "relogin_required";

interface StatusReport {
	status: ServiceStatus;
	detail: string;
}

const STATUS_META: Record<
	ServiceStatus,
	{ label: string; dot: string; badge: string }
> = {
	offline: {
		label: "Session service offline",
		dot: "bg-neutral-400",
		badge:
			"bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
	},
	not_connected: {
		label: "Kairuku: Not connected",
		dot: "bg-red-500",
		badge: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
	},
	login_window_open: {
		label: "Kairuku: Login window open",
		dot: "bg-yellow-400",
		badge:
			"bg-yellow-50 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300",
	},
	checking: {
		label: "Kairuku: Checking session…",
		dot: "bg-yellow-400",
		badge:
			"bg-yellow-50 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300",
	},
	live: {
		label: "Kairuku: Live / Ready",
		dot: "bg-green-500",
		badge:
			"bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300",
	},
	relogin_required: {
		label: "Kairuku: Re-login required",
		dot: "bg-yellow-400",
		badge:
			"bg-yellow-50 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300",
	},
};

async function callService(
	path: string,
	method: "GET" | "POST",
): Promise<StatusReport> {
	const res = await fetch(`${SERVICE_URL}${path}`, { method });
	const body = (await res.json()) as Partial<StatusReport> & { error?: string };
	if (!body.status) throw new Error(body.error ?? "Unexpected service reply");
	return {
		status: body.status,
		detail: body.error ?? body.detail ?? "",
	};
}

export function KairukuSession() {
	const [report, setReport] = useState<StatusReport>({
		status: "offline",
		detail: "",
	});
	const [busy, setBusy] = useState<string | null>(null);
	const busyRef = useRef<string | null>(null);
	busyRef.current = busy;

	const refresh = useCallback(async () => {
		// Don't clobber the UI mid-action; the action updates it itself.
		if (busyRef.current) return;
		try {
			setReport(await callService("/api/kairuku/status", "GET"));
		} catch {
			setReport({ status: "offline", detail: "" });
		}
	}, []);

	// Poll the service so the status flips to Live on its own once the
	// watcher detects the login and closes the window.
	useEffect(() => {
		void refresh();
		const t = setInterval(() => void refresh(), 2_500);
		return () => clearInterval(t);
	}, [refresh]);

	const runAction = async (name: string, path: string) => {
		if (busy) return;
		setBusy(name);
		try {
			setReport(await callService(path, "POST"));
		} catch (err) {
			const offline = err instanceof TypeError; // fetch network failure
			setReport({
				status: offline ? "offline" : report.status,
				detail: offline
					? ""
					: err instanceof Error
						? err.message
						: "Something went wrong.",
			});
		} finally {
			setBusy(null);
		}
	};

	const meta = STATUS_META[report.status];
	const offline = report.status === "offline";
	const disabled = offline || busy !== null;

	const btn =
		"rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-default disabled:opacity-40";

	return (
		<div className="mx-auto w-full max-w-2xl">
			<h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
				Kairuku Session
			</h2>
			<p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
				Log in to Kairuku once; future Kairuku tools reuse the session. Your
				password and MFA code are typed by you, in the browser window — the app
				never sees or stores them.
			</p>

			{/* Status card */}
			<div className="rounded-2xl border border-neutral-200 bg-white/80 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70">
				<div
					className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${meta.badge}`}
				>
					<span
						className={`h-2.5 w-2.5 rounded-full ${meta.dot} ${
							report.status === "checking" || report.status === "login_window_open"
								? "animate-pulse"
								: ""
						}`}
					/>
					{meta.label}
				</div>
				{report.detail && (
					<p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
						{report.detail}
					</p>
				)}

				{offline ? (
					<div className="mt-4 rounded-lg bg-neutral-50 p-4 text-sm text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
						The Kairuku session service isn't running. The easy fix: close
						this app and double-click <strong>Start Abyrx Tools</strong> in
						the tools folder — it starts the app and the service together.
						(Terminal alternative:{" "}
						<code className="font-mono">npm run kairuku:session</code>.) This
						tab connects automatically once it's up.
					</div>
				) : (
					<div className="mt-5 flex flex-wrap gap-3">
						<button
							onClick={() => void runAction("open", "/api/kairuku/open-login")}
							disabled={disabled || report.status === "login_window_open"}
							className={`${btn} bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200`}
						>
							{busy === "open" ? "Opening…" : "Open Kairuku Login Window"}
						</button>
						<button
							onClick={() => void runAction("check", "/api/kairuku/check")}
							disabled={disabled || report.status === "login_window_open"}
							className={`${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800`}
						>
							{busy === "check" ? "Checking…" : "Check Session Status"}
						</button>
						<button
							onClick={() => void runAction("close", "/api/kairuku/close")}
							disabled={disabled || report.status !== "login_window_open"}
							className={`${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800`}
						>
							Close Login Window
						</button>
					</div>
				)}
			</div>

			{/* How it works */}
			<div className="mt-6 rounded-2xl border border-neutral-200 bg-white/60 p-5 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-400">
				<h3 className="mb-2 font-semibold text-neutral-800 dark:text-neutral-100">
					How it works
				</h3>
				<ol className="list-decimal space-y-1 pl-5">
					<li>
						<strong>Open Kairuku Login Window</strong> opens a real Chromium
						window at{" "}
						<span className="font-mono text-xs">{KAIRUKU_URL}</span> using a
						persistent local browser profile.
					</li>
					<li>Log in and enter the MFA code from your text, in that window.</li>
					<li>
						Once you're in, the window closes by itself and the status here
						turns green: <em>Live / Ready</em>.
					</li>
					<li>
						The session lives in a private browser profile in your home folder
						(<span className="font-mono text-xs">~/.abyrx-kairuku/</span>), so it
						survives restarting the app — and even replacing the tools folder
						with a fresh download. Use <strong>Check Session Status</strong> to
						confirm.
					</li>
					<li>
						Future Kairuku tools call{" "}
						<span className="font-mono text-xs">requireKairukuSession()</span>{" "}
						to reuse the logged-in session, and send you back here if a
						re-login is ever needed.
					</li>
				</ol>
			</div>
		</div>
	);
}
