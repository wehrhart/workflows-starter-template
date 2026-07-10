import { useMemo, useState } from "react";
import { lookupPrice, formatReport, normalizeCode } from "../../worker/lib/price-lookup";
import { PRICE_DATA } from "../../worker/lib/price-data";
import type { PriceLookup } from "../../worker/lib/price-types";

function Chip({ tone, children }: { tone: "ok" | "neutral" | "warn"; children: React.ReactNode }) {
	const cls =
		tone === "ok"
			? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
			: tone === "warn"
				? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
				: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300";
	return <span className={`rounded-lg px-3 py-1.5 text-sm font-medium ${cls}`}>{children}</span>;
}

function ProductTable({ result }: { result: PriceLookup }) {
	const total = result.approved.length + result.systemExtras.length;
	if (total === 0) {
		return (
			<div className="mt-4 rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-500 dark:bg-neutral-800/50 dark:text-neutral-400">
				No products are approved at this facility or its sister facilities in the snapshot.
			</div>
		);
	}
	return (
		<div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
			<table className="w-full text-left text-sm">
				<thead className="bg-neutral-100 text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
					<tr>
						<th className="px-3 py-2 font-medium">Product</th>
						<th className="px-3 py-2 font-medium">Price</th>
						<th className="px-3 py-2 font-medium">Source</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
					{result.approved.map((p, i) => (
						<tr key={`h-${i}`}>
							<td className="px-3 py-2 text-neutral-800 dark:text-neutral-100">{p.product}</td>
							<td className="px-3 py-2 font-medium tabular-nums text-neutral-700 dark:text-neutral-200">
								{p.price}
							</td>
							<td className="px-3 py-2">
								<span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
									This facility
								</span>
								{p.priceFrom && (
									<span className="ml-1 text-[11px] text-neutral-500 dark:text-neutral-400">
										price via #{p.priceFrom.code} · {p.priceFrom.name}
									</span>
								)}
							</td>
						</tr>
					))}
					{result.systemExtras.map((p, i) => (
						<tr key={`s-${i}`} className="bg-amber-50/40 dark:bg-amber-900/5">
							<td className="px-3 py-2 text-neutral-800 dark:text-neutral-100">{p.product}</td>
							<td className="px-3 py-2 font-medium tabular-nums text-neutral-700 dark:text-neutral-200">
								{p.price}
							</td>
							<td className="px-3 py-2">
								<span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
									#{p.sourceCode} · {p.sourceName}
								</span>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function PriceInformation() {
	const [input, setInput] = useState("");
	const [submitted, setSubmitted] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const result = useMemo(
		() => (submitted ? lookupPrice(submitted) : null),
		[submitted],
	);

	const run = () => {
		setCopied(false);
		setSubmitted(input);
	};

	const copy = async () => {
		if (!result) return;
		try {
			await navigator.clipboard.writeText(formatReport(result));
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// ignore clipboard failures
		}
	};

	const normalized = normalizeCode(input);

	return (
		<div className="mx-auto w-full max-w-3xl">
			<div className="mb-5">
				<h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
					Price Information
				</h2>
				<p className="text-sm text-neutral-500 dark:text-neutral-400">
					Enter a facility code — get every approved product and price for that facility,
					plus approvals from its sister facilities in the same health system.
				</p>
			</div>

			<div className="rounded-2xl border border-neutral-200 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/70">
				<div className="flex flex-wrap gap-2">
					<input
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && run()}
						inputMode="numeric"
						placeholder="Facility code, e.g. 6443 or FA6443"
						className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-800 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
					/>
					<button
						onClick={run}
						disabled={!normalized}
						className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
					>
						Look up
					</button>
				</div>

				{result && !result.found && (
					<div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
						{result.code
							? `No facility with code #${result.code} in the snapshot.`
							: "Enter a facility code to look up."}
					</div>
				)}

				{result && result.found && result.facility && (
					<div className="mt-5">
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<div>
								<div className="text-base font-semibold text-neutral-800 dark:text-neutral-100">
									{result.facility.name}{" "}
									<span className="text-sm font-normal text-neutral-400">#{result.code}</span>
								</div>
								<div className="text-xs text-neutral-500 dark:text-neutral-400">
									{result.facility.city}, {result.facility.state}
									{result.systemName ? ` · ${result.systemName}` : " · no health system matched"}
								</div>
							</div>
							<button
								onClick={copy}
								className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
							>
								{copied ? "Copied ✓" : "Copy report"}
							</button>
						</div>

						<div className="mt-3 flex flex-wrap gap-2">
							<Chip tone="ok">
								{result.approved.length} approved here
							</Chip>
							{result.systemExtras.length > 0 && (
								<Chip tone="warn">+{result.systemExtras.length} from sister facilities</Chip>
							)}
							{result.sisters.length > 0 && (
								<Chip tone="neutral">{result.sisters.length} sister facilities</Chip>
							)}
						</div>

						<ProductTable result={result} />

						{result.sisters.length > 0 && (
							<details className="mt-4 text-sm">
								<summary className="cursor-pointer text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200">
									Sister facilities checked ({result.sisters.length}) — verify these are the
									right system
								</summary>
								<ul className="mt-2 space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
									{result.sisters.map((s) => (
										<li key={s.code}>
											#{s.code} · {s.name} — {s.city}, {s.state}
											{s.approvedCount > 0 ? ` · ${s.approvedCount} approved` : ""}
										</li>
									))}
								</ul>
							</details>
						)}
					</div>
				)}
			</div>

			<p className="mt-4 text-xs text-neutral-400">
				Snapshot of KAIRUKU as of {PRICE_DATA.generatedAt} · {PRICE_DATA.facilityCount}{" "}
				facilities. Health systems are inferred from facility names (KAIRUKU has no system
				field), so sister facilities are a best-effort match — check the list before relying
				on cross-facility approvals. Runs entirely in your browser.
			</p>
		</div>
	);
}
