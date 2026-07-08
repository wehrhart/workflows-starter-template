import { useMemo, useRef, useState } from "react";
import { useWorkflowWebSocket } from "../hooks/useWorkflowWebSocket";
import { PIPELINE_STEPS } from "../types";
import type { StepStatus, FileSummary } from "../types";

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
					{files.map((f) => (
						<tr key={f.sourceFile}>
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

/** Kaiser Billing tool — bill sheet PDFs → filled Bill-Only upload spreadsheet. */
export function KaiserBilling() {
	const [instanceId, setInstanceId] = useState<string | null>(null);
	const [files, setFiles] = useState<File[]>([]);
	const [isStarting, setIsStarting] = useState(false);
	const [dragOver, setDragOver] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const state = useWorkflowWebSocket(instanceId);
	const started = instanceId !== null;

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

	const reset = () => {
		setInstanceId(null);
		setFiles([]);
		setUploadError(null);
	};

	const completed = state.workflowStatus === "completed" && state.result;
	const errored = state.workflowStatus === "error";
	const summary = useMemo(() => state.result, [state.result]);

	return (
		<div className="mx-auto w-full max-w-3xl">
			<div className="mb-5">
				<h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
					Kaiser Billing
				</h2>
				<p className="text-sm text-neutral-500 dark:text-neutral-400">
					Drop Kaiser bill sheet PDFs → get a ready-to-upload Bill-Only
					spreadsheet.
				</p>
			</div>

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
								: `Generate upload sheet${files.length ? ` (${files.length})` : ""}`}
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

						{completed && summary && (
							<div className="mt-5 space-y-4">
								<div className="flex flex-wrap gap-3 text-sm">
									<span className="rounded-lg bg-emerald-100 px-3 py-1.5 font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
										{summary.uploadRows} upload row
										{summary.uploadRows === 1 ? "" : "s"}
									</span>
									{summary.missingRows > 0 && (
										<span className="rounded-lg bg-amber-100 px-3 py-1.5 font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
											{summary.missingRows} missing Case ID
										</span>
									)}
								</div>

								<FileTable files={summary.files} />

								<a
									href={`/api/bill-sheets/${instanceId}/download`}
									className="block w-full rounded-xl bg-neutral-900 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
								>
									Download {summary.fileName}
								</a>
							</div>
						)}

						{(completed || errored) && (
							<button
								onClick={reset}
								className="mt-4 w-full rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
							>
								Process more bill sheets
							</button>
						)}
					</>
				)}
			</div>

			<p className="mt-4 text-xs text-neutral-400">
				Missing Case IDs are collected on a separate tab in the downloaded
				workbook. The Generate-File macro and drop-downs are preserved.
			</p>
		</div>
	);
}
