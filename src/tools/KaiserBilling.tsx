import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkflowWebSocket } from "../hooks/useWorkflowWebSocket";
import { PIPELINE_STEPS } from "../types";
import type { StepStatus, FileSummary, LedgerSummary } from "../types";

function StepRow({
	name,
	description,
	status,
}: {
	name: string;
	description: string;
	status: StepStatus;
}) {
	const dot =
		status === "completed"
			? "bg-emerald-500"
			: status === "running"
				? "bg-amber-500 animate-pulse"
				: status === "error"
					? "bg-red-500"
					: "bg-neutral-300 dark:bg-neutral-600";
	return (
		<div className="flex items-start gap-3 py-2">
			<span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
			<div>
				<div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
					{name}
				</div>
				<div className="text-xs text-neutral-500 dark:text-neutral-400">
					{description}
				</div>
			</div>
			<span className="ml-auto text-xs font-medium capitalize text-neutral-400">
				{status}
			</span>
		</div>
	);
}

function FileTable({ files }: { files: FileSummary[] }) {
	return (
		<div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
			<table className="w-full text-left text-xs">
				<thead className="bg-neutral-100 text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
					<tr>
						<th className="px-3 py-2 font-medium">Bill sheet</th>
						<th className="px-3 py-2 font-medium">Case ID</th>
						<th className="px-3 py-2 font-medium">Surgery location</th>
						<th className="px-3 py-2 font-medium">Lines</th>
						<th className="px-3 py-2 font-medium">Result</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
					{files.map((f, i) => (
						<tr key={`${f.sourceFile}-${i}`}>
							<td className="max-w-[14rem] truncate px-3 py-2 text-neutral-700 dark:text-neutral-200">
								{f.sourceFile}
							</td>
							<td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
								{f.caseId ?? "—"}
							</td>
							<td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
								{f.locationId
									? `${f.locationId}${f.locationName ? ` · ${f.locationName}` : ""}`
									: "—"}
							</td>
							<td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
								{f.lineItems}
							</td>
							<td className="px-3 py-2">
								{f.routed === "upload" ? (
									<span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
										Added
									</span>
								) : (
									<span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
										Missing Case ID
									</span>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** The always-visible running master sheet: totals, download, clear. */
function MasterPanel({
	ledger,
	onClear,
}: {
	ledger: LedgerSummary | null;
	onClear: () => void;
}) {
	const rows = ledger?.totalRows ?? 0;
	const missing = ledger?.totalMissing ?? 0;
	const sheets = ledger?.files.length ?? 0;
	const empty = rows === 0 && missing === 0;

	return (
		<div className="mb-6 rounded-2xl border border-neutral-200 bg-white/80 p-5 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/70">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<div className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
						Master sheet
					</div>
					<div className="text-xs text-neutral-500 dark:text-neutral-400">
						{empty
							? "Empty — process a bill sheet to start filling it."
							: `${rows} row${rows === 1 ? "" : "s"} from ${sheets} bill sheet${sheets === 1 ? "" : "s"}${missing ? ` · ${missing} missing Case ID` : ""}`}
					</div>
				</div>
				<div className="flex gap-2">
					<a
						href="/api/ledger/download"
						download="Abyrx_Bill_Only_Upload.xlsm"
						aria-disabled={empty}
						onClick={(e) => {
							if (empty) e.preventDefault();
						}}
						className={`rounded-xl px-4 py-2 text-sm font-medium ${
							empty
								? "cursor-not-allowed bg-neutral-200 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"
								: "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
						}`}
					>
						Download master sheet
					</a>
					<button
						onClick={onClear}
						disabled={empty}
						className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
					>
						Clear
					</button>
				</div>
			</div>
		</div>
	);
}

/** Kaiser Billing tool — bill sheet PDFs accumulate into one master upload sheet. */
export function KaiserBilling() {
	const [instanceId, setInstanceId] = useState<string | null>(null);
	const [files, setFiles] = useState<File[]>([]);
	const [isStarting, setIsStarting] = useState(false);
	const [dragOver, setDragOver] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [ledger, setLedger] = useState<LedgerSummary | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const state = useWorkflowWebSocket(instanceId);
	const started = instanceId !== null;

	const refreshLedger = useCallback(async () => {
		try {
			const res = await fetch("/api/ledger");
			if (res.ok) setLedger(await res.json());
		} catch {
			// ignore
		}
	}, []);

	useEffect(() => {
		refreshLedger();
	}, [refreshLedger]);

	// When a batch finishes, the master sheet changed — refresh it.
	useEffect(() => {
		if (state.workflowStatus === "completed") refreshLedger();
	}, [state.workflowStatus, refreshLedger]);

	const addFiles = (list: FileList | null) => {
		if (!list) return;
		const pdfs = Array.from(list).filter(
			(f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
		);
		setFiles((prev) => {
			const seen = new Set(prev.map((f) => f.name + f.size));
			return [...prev, ...pdfs.filter((f) => !seen.has(f.name + f.size))];
		});
	};

	const start = async () => {
		if (files.length === 0) return;
		setIsStarting(true);
		setUploadError(null);
		try {
			const form = new FormData();
			files.forEach((f) => form.append("files", f));
			const res = await fetch("/api/bill-sheets", { method: "POST", body: form });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Upload failed");
			setInstanceId(data.instanceId);
		} catch (err) {
			setUploadError(err instanceof Error ? err.message : "Upload failed");
		} finally {
			setIsStarting(false);
		}
	};

	const processMore = () => {
		setInstanceId(null);
		setFiles([]);
		setUploadError(null);
	};

	const clearMaster = async () => {
		if (!confirm("Clear the master sheet? Do this after you've uploaded it to Kaiser.")) return;
		await fetch("/api/ledger/clear", { method: "POST" });
		refreshLedger();
	};

	const completed = state.workflowStatus === "completed" && state.result;
	const errored = state.workflowStatus === "error";

	return (
		<div className="mx-auto w-full max-w-3xl">
			<div className="mb-5">
				<h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
					Kaiser Billing
				</h2>
				<p className="text-sm text-neutral-500 dark:text-neutral-400">
					Process bill sheets as they come in — rows pile into one master sheet
					you download and upload to Kaiser.
				</p>
			</div>

			<MasterPanel ledger={ledger} onClear={clearMaster} />

			<div className="rounded-2xl border border-neutral-200 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/70">
				{!started && (
					<>
						<div
							onDragOver={(e) => {
								e.preventDefault();
								setDragOver(true);
							}}
							onDragLeave={() => setDragOver(false)}
							onDrop={(e) => {
								e.preventDefault();
								setDragOver(false);
								addFiles(e.dataTransfer.files);
							}}
							onClick={() => inputRef.current?.click()}
							className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
								dragOver
									? "border-amber-400 bg-amber-50/60 dark:bg-amber-900/10"
									: "border-neutral-300 hover:border-neutral-400 dark:border-neutral-700"
							}`}
						>
							<p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
								Drop bill sheet PDFs here, or click to choose
							</p>
							<p className="mt-1 text-xs text-neutral-500">
								One or many at a time · PDF only
							</p>
							<input
								ref={inputRef}
								type="file"
								accept="application/pdf"
								multiple
								className="hidden"
								onChange={(e) => addFiles(e.target.files)}
							/>
						</div>

						{files.length > 0 && (
							<ul className="mt-4 space-y-1">
								{files.map((f) => (
									<li
										key={f.name + f.size}
										className="flex items-center justify-between rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-800/60"
									>
										<span className="truncate text-neutral-700 dark:text-neutral-200">
											{f.name}
										</span>
										<button
											onClick={() =>
												setFiles((prev) => prev.filter((x) => x !== f))
											}
											className="ml-3 text-xs text-neutral-400 hover:text-red-500"
										>
											Remove
										</button>
									</li>
								))}
							</ul>
						)}

						{uploadError && (
							<p className="mt-3 text-sm text-red-500">{uploadError}</p>
						)}

						<button
							onClick={start}
							disabled={files.length === 0 || isStarting}
							className="mt-5 w-full rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
						>
							{isStarting
								? "Uploading…"
								: `Add to master sheet${files.length ? ` (${files.length})` : ""}`}
						</button>
					</>
				)}

				{started && (
					<>
						<div className="divide-y divide-neutral-100 dark:divide-neutral-800">
							{PIPELINE_STEPS.map((step) => (
								<StepRow
									key={step.name}
									name={step.name}
									description={step.description}
									status={
										errored && state.currentStep === step.name
											? "error"
											: (state.stepStatuses[step.name] as StepStatus) ??
												"pending"
									}
								/>
							))}
						</div>

						{errored && (
							<div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
								{state.errorMessage ?? "Processing failed."}
							</div>
						)}

						{completed && state.result && (
							<div className="mt-5 space-y-4">
								<div className="flex flex-wrap gap-3 text-sm">
									<span className="rounded-lg bg-emerald-100 px-3 py-1.5 font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
										+{state.result.addedRows} row
										{state.result.addedRows === 1 ? "" : "s"} added
									</span>
									{state.result.addedMissing > 0 && (
										<span className="rounded-lg bg-amber-100 px-3 py-1.5 font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
											{state.result.addedMissing} missing Case ID
										</span>
									)}
									<span className="rounded-lg bg-neutral-100 px-3 py-1.5 font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
										master now: {state.result.totalRows} rows
									</span>
								</div>

								<FileTable files={state.result.files} />
							</div>
						)}

						{(completed || errored) && (
							<button
								onClick={processMore}
								className="mt-4 w-full rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
							>
								Process more bill sheets
							</button>
						)}
					</>
				)}
			</div>

			<p className="mt-4 text-xs text-neutral-400">
				Each bill sheet's rows are added to the master sheet above. Download it
				whenever you're ready to upload to Kaiser, then Clear to start the next
				batch. Missing Case IDs collect on a separate tab. The Generate-File
				macro and drop-downs are preserved.
			</p>
		</div>
	);
}
