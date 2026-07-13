import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Demo Units — photo of a shipping sheet → demo unit entries in Kairuku.
 *
 * Needs the local session service (same one as the Kairuku Session tab) AND a
 * live Kairuku session. Flow: upload the sheet photo → review/fix the
 * extracted tracking number, rep name, and M/C/G/T/H/HA/P quantities →
 * Submit → watch the automation run step by step. Overage cases accumulate on
 * the "Overage reps" sheet, downloadable below.
 */

const SERVICE_URL = "http://127.0.0.1:5281";

interface Quantities {
	montage: string;
	cartridge: string;
	gun: string;
	tips: string;
	hemasorb: string;
	hemasorbApply: string;
	permatage: string;
}

const EMPTY_QTY: Quantities = {
	montage: "",
	cartridge: "",
	gun: "",
	tips: "",
	hemasorb: "",
	hemasorbApply: "",
	permatage: "",
};

const QTY_FIELDS: { key: keyof Quantities; label: string; sheet: string }[] = [
	{ key: "montage", label: "Montage", sheet: "M" },
	{ key: "gun", label: "Gun", sheet: "G" },
	{ key: "cartridge", label: "Cartridge", sheet: "C" },
	{ key: "tips", label: "Tips", sheet: "T" },
	{ key: "hemasorb", label: "Hemasorb", sheet: "H" },
	{ key: "hemasorbApply", label: "Hemasorb Apply", sheet: "HA" },
	{ key: "permatage", label: "Permatage", sheet: "P" },
];

interface RunStep {
	label: string;
	status: "running" | "done" | "failed" | "skipped";
	detail?: string;
}

interface Run {
	state: "running" | "completed" | "failed" | "none";
	steps?: RunStep[];
	outcome?: string;
	screenshot?: string;
	debugDir?: string;
}

interface OverageRow {
	rep: string;
	date: string;
	type: string;
}

type Stage = "upload" | "extracting" | "review" | "running" | "done";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${SERVICE_URL}${path}`, init);
	const body = (await res.json()) as T & { error?: string };
	if (!res.ok) throw new Error(body.error ?? `Service error (${res.status})`);
	return body;
}

export function DemoUnits() {
	const [serviceOnline, setServiceOnline] = useState(false);
	const [kairukuLive, setKairukuLive] = useState(false);
	const [stage, setStage] = useState<Stage>("upload");
	const [error, setError] = useState<string | null>(null);

	const [tracking, setTracking] = useState("");
	const [repName, setRepName] = useState("");
	const [qty, setQty] = useState<Quantities>(EMPTY_QTY);
	const [dryRun, setDryRun] = useState(false);
	const [readerNote, setReaderNote] = useState<string | null>(null);

	const [run, setRun] = useState<Run>({ state: "none" });
	const [overage, setOverage] = useState<OverageRow[]>([]);
	const fileRef = useRef<HTMLInputElement>(null);

	const refreshStatus = useCallback(async () => {
		try {
			const s = await api<{ status: string }>("/api/kairuku/status");
			setServiceOnline(true);
			setKairukuLive(s.status === "live");
		} catch {
			setServiceOnline(false);
			setKairukuLive(false);
		}
	}, []);

	const refreshOverage = useCallback(async () => {
		try {
			const r = await api<{ rows: OverageRow[] }>("/api/kairuku/overage");
			setOverage(r.rows);
		} catch {
			/* service offline — table just stays as-is */
		}
	}, []);

	useEffect(() => {
		const kick = setTimeout(() => {
			void refreshStatus();
			void refreshOverage();
		}, 0);
		const t = setInterval(() => void refreshStatus(), 3_000);
		return () => {
			clearTimeout(kick);
			clearInterval(t);
		};
	}, [refreshStatus, refreshOverage]);

	// Poll run progress while running.
	useEffect(() => {
		if (stage !== "running") return;
		const t = setInterval(async () => {
			try {
				const r = await api<Run>("/api/kairuku/demo-units/run");
				setRun(r);
				if (r.state === "completed" || r.state === "failed") {
					setStage("done");
					void refreshOverage();
				}
			} catch {
				/* keep polling */
			}
		}, 1_500);
		return () => clearInterval(t);
	}, [stage, refreshOverage]);

	const onPhoto = async (file: File) => {
		setError(null);
		setStage("extracting");
		try {
			const b64 = await new Promise<string>((resolve, reject) => {
				const r = new FileReader();
				r.onload = () => resolve(String(r.result));
				r.onerror = () => reject(new Error("Couldn't read the photo"));
				r.readAsDataURL(file);
			});
			const ex = await api<{
				trackingNumber: string;
				repName: string;
				quantities: Record<string, number | null>;
				reader?: string;
				readerNote?: string;
			}>("/api/kairuku/demo-units/extract", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ imageBase64: b64 }),
			});
			setTracking(ex.trackingNumber);
			setRepName(ex.repName);
			setReaderNote(
				ex.reader === "claude"
					? "Read by Claude vision — double-check, then Submit."
					: (ex.readerNote ?? null),
			);
			const next = { ...EMPTY_QTY };
			for (const f of QTY_FIELDS) {
				const v = ex.quantities?.[f.key];
				if (typeof v === "number") next[f.key] = String(v);
			}
			setQty(next);
			setStage("review");
		} catch (err) {
			setError(
				err instanceof TypeError
					? "Couldn't reach the local session service. Close everything and double-click Start Abyrx Tools — it starts the app and the service together."
					: err instanceof Error
						? err.message
						: "Extraction failed",
			);
			setStage("upload");
		}
	};

	const submit = async () => {
		setError(null);
		if (!/^\d{12}$/.test(tracking.trim())) {
			setError("Tracking number should be exactly 12 digits.");
			return;
		}
		if (!repName.trim().includes(" ")) {
			setError("Enter the rep's first and last name.");
			return;
		}
		const n = (s: string) => (s.trim() === "" ? 0 : Number(s));
		const quantities = {
			montage: n(qty.montage),
			cartridge: n(qty.cartridge),
			gun: n(qty.gun),
			tips: n(qty.tips),
			hemasorb: n(qty.hemasorb),
			hemasorbApply: n(qty.hemasorbApply),
			permatage: n(qty.permatage),
		};
		if (Object.values(quantities).some((v) => Number.isNaN(v) || v < 0)) {
			setError("Quantities must be plain numbers.");
			return;
		}
		if (Object.values(quantities).every((v) => v === 0)) {
			setError("Enter at least one quantity.");
			return;
		}
		try {
			const r = await api<Run>("/api/kairuku/demo-units/run", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					trackingNumber: tracking.trim(),
					repName: repName.trim(),
					quantities,
					dryRun,
				}),
			});
			setRun(r);
			setStage("running");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't start the run");
		}
	};

	const reset = () => {
		setStage("upload");
		setTracking("");
		setRepName("");
		setQty(EMPTY_QTY);
		setRun({ state: "none" });
		setError(null);
		setReaderNote(null);
		if (fileRef.current) fileRef.current.value = "";
	};

	const input =
		"w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
	const btn =
		"rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-default disabled:opacity-40";
	const primaryBtn = `${btn} bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200`;
	const ghostBtn = `${btn} border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800`;

	const stepDot = (s: RunStep["status"]) =>
		s === "done"
			? "bg-green-500"
			: s === "failed"
				? "bg-red-500"
				: s === "skipped"
					? "bg-neutral-400"
					: "animate-pulse bg-yellow-400";

	return (
		<div className="mx-auto w-full max-w-2xl">
			<h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
				Demo Units
			</h2>
			<p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
				Snap the shipping sheet → check what was read → the tool enters the demo
				in Kairuku for you.
			</p>

			{/* Gate: service + live session */}
			{!serviceOnline && (
				<div className="mb-4 rounded-2xl border border-neutral-200 bg-white/80 p-5 text-sm text-neutral-600 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-300">
					The local service isn't running — double-click{" "}
					<strong>Start Abyrx Tools</strong> in the tools folder, then come back
					to this tab.
				</div>
			)}
			{serviceOnline && !kairukuLive && (
				<div className="mb-4 rounded-2xl border border-yellow-300 bg-yellow-50 p-5 text-sm text-yellow-800 shadow-sm dark:border-yellow-900 dark:bg-yellow-950/60 dark:text-yellow-300">
					<strong>Kairuku isn't live.</strong> Demo Units needs the logged-in
					session — open the{" "}
					<a href="#/kairuku-session" className="underline">
						Kairuku Session
					</a>{" "}
					tab, get it green (Live / Ready), then come back. If you just started
					the app, hit "Check Session Status" there.
				</div>
			)}

			{/* Stage: upload */}
			{(stage === "upload" || stage === "extracting") && (
				<div className="rounded-2xl border border-neutral-200 bg-white/80 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70">
					<h3 className="mb-1 font-semibold text-neutral-800 dark:text-neutral-100">
						1 · Shipping sheet photo
					</h3>
					<p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
						It reads the tracking number, the rep's name, and the handwritten
						M / C / G / T / H / HA / P quantities in the top right. You'll get
						to fix anything it misreads next.
					</p>
					<input
						ref={fileRef}
						type="file"
						accept="image/*,.heic,.heif"
						disabled={stage === "extracting" || !serviceOnline}
						onChange={(e) => {
							const f = e.target.files?.[0];
							if (f) void onPhoto(f);
						}}
						className="block w-full text-sm text-neutral-600 file:mr-4 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-700 dark:text-neutral-300 dark:file:bg-white dark:file:text-neutral-900"
					/>
					{stage === "extracting" && (
						<p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
							Reading the sheet — up to a minute. The tracking number is only
							auto-filled when it passes the FedEx check digit; anything the
							reader isn't sure of is left blank for you to type.
						</p>
					)}
				</div>
			)}

			{/* Stage: review */}
			{stage === "review" && (
				<div className="rounded-2xl border border-neutral-200 bg-white/80 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70">
					<h3 className="mb-1 font-semibold text-neutral-800 dark:text-neutral-100">
						2 · Check &amp; fix
					</h3>
					<p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
						Everything below is editable — fix any misreads, fill in what's
						missing, then Submit.
					</p>
					{readerNote && (
						<p className="mb-4 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
							{readerNote}
						</p>
					)}
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<label className="block">
							<span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
								Tracking number (12 digits)
							</span>
							<input
								value={tracking}
								onChange={(e) => setTracking(e.target.value)}
								className={`${input} font-mono`}
								inputMode="numeric"
							/>
						</label>
						<label className="block">
							<span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
								Rep name (First Last)
							</span>
							<input
								value={repName}
								onChange={(e) => setRepName(e.target.value)}
								className={input}
							/>
						</label>
					</div>
					<div className="mt-5">
						<span className="mb-2 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
							Quantities — leave blank anything not in this demo
						</span>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							{QTY_FIELDS.map((f) => (
								<label key={f.key} className="block">
									<span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
										{f.label}{" "}
										<span className="text-neutral-400 dark:text-neutral-600">
											({f.sheet})
										</span>
									</span>
									<input
										value={qty[f.key]}
										onChange={(e) => setQty({ ...qty, [f.key]: e.target.value })}
										className={input}
										inputMode="numeric"
										placeholder="—"
									/>
								</label>
							))}
						</div>
					</div>
					<label className="mt-5 flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-300">
						<input
							type="checkbox"
							checked={dryRun}
							onChange={(e) => setDryRun(e.target.checked)}
							className="mt-0.5"
						/>
						<span>
							<strong>Dry run</strong> — walk every Kairuku step and fill every
							field, but stop right before Save. Nothing is entered, nothing is
							logged. Use this to test safely.
						</span>
					</label>
					<div className="mt-4 flex flex-wrap gap-3">
						<button onClick={() => void submit()} disabled={!kairukuLive} className={primaryBtn}>
							{dryRun ? "Dry run — don't save" : "Submit — enter in Kairuku"}
						</button>
						<button onClick={reset} className={ghostBtn}>
							Start over
						</button>
					</div>
					{!kairukuLive && (
						<p className="mt-2 text-xs text-yellow-700 dark:text-yellow-400">
							Submit unlocks once Kairuku is Live / Ready.
						</p>
					)}
				</div>
			)}

			{/* Stage: running / done */}
			{(stage === "running" || stage === "done") && (
				<div className="rounded-2xl border border-neutral-200 bg-white/80 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70">
					<h3 className="mb-3 font-semibold text-neutral-800 dark:text-neutral-100">
						3 · {stage === "running" ? "Entering in Kairuku…" : "Result"}
					</h3>
					<div className="space-y-2">
						{(run.steps ?? []).map((s, i) => (
							<div key={i} className="flex items-start gap-2 text-sm">
								<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${stepDot(s.status)}`} />
								<div>
									<span className="text-neutral-700 dark:text-neutral-300">{s.label}</span>
									{s.detail && (
										<span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
											{s.detail}
										</span>
									)}
								</div>
							</div>
						))}
					</div>
					{stage === "done" && (
						<>
							<div
								className={`mt-4 rounded-lg p-4 text-sm ${
									run.state === "completed"
										? "bg-green-50 text-green-800 dark:bg-green-950/60 dark:text-green-300"
										: "bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-300"
								}`}
							>
								{run.outcome ?? (run.state === "completed" ? "Done." : "Something went wrong.")}
								{run.screenshot && (
									<div className="mt-2 text-xs opacity-80">
										A screenshot of where it stopped was saved to{" "}
										<span className="font-mono">{run.screenshot}</span> — send it
										to Claude to get the step fixed.
									</div>
								)}
								{run.debugDir && (
									<div className="mt-2 text-xs opacity-80">
										Every step of this run was photographed to{" "}
										<span className="font-mono">{run.debugDir}</span> — send those
										images to Claude to review the run screen by screen.
									</div>
								)}
							</div>
							<button onClick={reset} className={`${primaryBtn} mt-4`}>
								Enter another demo
							</button>
						</>
					)}
				</div>
			)}

			{error && (
				<p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
			)}

			{/* Overage reps sheet */}
			<div className="mt-6 rounded-2xl border border-neutral-200 bg-white/60 p-5 dark:border-neutral-800 dark:bg-neutral-900/50">
				<div className="mb-3 flex items-center justify-between gap-3">
					<h3 className="font-semibold text-neutral-800 dark:text-neutral-100">
						Overage reps
					</h3>
					<a
						href={`${SERVICE_URL}/api/kairuku/overage.xlsx`}
						className={`${ghostBtn} ${overage.length === 0 ? "pointer-events-none opacity-40" : ""}`}
					>
						Download Excel
					</a>
				</div>
				{overage.length === 0 ? (
					<p className="text-sm text-neutral-500 dark:text-neutral-400">
						Empty — reps land here when Kairuku shows "Request Overage" or the
						rep isn't found ("NOT IN k.").
					</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-sm">
							<thead>
								<tr className="text-xs text-neutral-500 dark:text-neutral-400">
									<th className="py-1 pr-4 font-medium">Rep Name</th>
									<th className="py-1 pr-4 font-medium">Date</th>
									<th className="py-1 font-medium">Type</th>
								</tr>
							</thead>
							<tbody>
								{overage.map((r, i) => (
									<tr key={i} className="border-t border-neutral-200 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
										<td className="py-1.5 pr-4">{r.rep}</td>
										<td className="py-1.5 pr-4">{r.date}</td>
										<td className="py-1.5">{r.type}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
