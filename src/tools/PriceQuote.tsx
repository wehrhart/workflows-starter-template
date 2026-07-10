import { useMemo, useState } from "react";
import {
	QUOTE_INPUTS,
	buildQuote,
	parsePrice,
	type PriceMap,
	type QuoteHeader,
} from "../../worker/lib/quote";
import { buildQuotePdfBlob } from "./quote-pdf";
import { saveBlob } from "./save-file";

const EMPTY_HEADER: QuoteHeader = {
	hospitalName: "",
	streetAddress: "",
	city: "",
	state: "",
	zip: "",
};

function Field({
	label,
	value,
	onChange,
	className,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	className?: string;
}) {
	return (
		<label className={`block ${className ?? ""}`}>
			<span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
				{label}
			</span>
			<input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
			/>
		</label>
	);
}

/**
 * Price Quote tool — fill hospital + per-product prices, generate a PDF quote
 * that matches the ABYRX template. Fully client-side: nothing leaves the device.
 */
export function PriceQuote() {
	const [header, setHeader] = useState<QuoteHeader>(EMPTY_HEADER);
	const [prices, setPrices] = useState<Record<string, string>>({});
	const [isGenerating, setIsGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pdf, setPdf] = useState<{ url: string; fileName: string } | null>(null);

	const setField = (k: keyof QuoteHeader, v: string) =>
		setHeader((h) => ({ ...h, [k]: v }));
	const setPrice = (id: string, v: string) => setPrices((p) => ({ ...p, [id]: v }));

	const filledCount = useMemo(
		() => QUOTE_INPUTS.filter((p) => parsePrice(prices[p.id]) != null).length,
		[prices],
	);

	/**
	 * ONE click: validate → build the PDF → hand it to the browser as a download.
	 * saveBlob is called synchronously within this click's gesture (required for
	 * sandboxed-iframe hosts like the artifact page). The button stays disabled
	 * briefly afterwards so a double-click can't save the file twice.
	 */
	const handleDownloadQuote = () => {
		if (isGenerating) return;
		setError(null);
		if (!header.hospitalName.trim()) {
			setError("Enter the hospital name — it's used in the quote and the file name.");
			return;
		}
		const priceMap: PriceMap = {};
		for (const p of QUOTE_INPUTS) priceMap[p.id] = parsePrice(prices[p.id]);
		const quote = buildQuote(header, priceMap, new Date());
		if (quote.lines.length === 0) {
			setError("Enter a price for at least one product.");
			return;
		}
		setIsGenerating(true);
		try {
			const blob = buildQuotePdfBlob(quote);
			// Try to start the download right away (works where the host allows
			// it)… and always show a real link too — some hosts block every
			// page-initiated download, but right-click → download still works.
			saveBlob(blob, quote.fileName);
			if (pdf) URL.revokeObjectURL(pdf.url);
			setPdf({ url: URL.createObjectURL(blob), fileName: quote.fileName });
		} catch (err) {
			console.error("Failed to download quote PDF", err);
			setError("Could not generate the quote PDF. Please try again.");
		} finally {
			// Cooldown: keep the button disabled long enough that an accidental
			// double-click can't fire a second identical download.
			setTimeout(() => setIsGenerating(false), 900);
		}
	};

	return (
		<div className="mx-auto w-full max-w-3xl">
			<div className="mb-5">
				<h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
					Price Quote Generator
				</h2>
				<p className="text-sm text-neutral-500 dark:text-neutral-400">
					Fill in the hospital and the prices you want to quote — generate a PDF
					that matches the ABYRX quote template exactly.
				</p>
			</div>

			<div className="space-y-6">
				{/* Hospital details */}
				<div className="rounded-2xl border border-neutral-200 bg-white/80 p-5 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/70">
					<div className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
						Quote to
					</div>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<Field
							label="Hospital name"
							value={header.hospitalName}
							onChange={(v) => setField("hospitalName", v)}
							className="sm:col-span-2"
						/>
						<Field
							label="Street address"
							value={header.streetAddress}
							onChange={(v) => setField("streetAddress", v)}
							className="sm:col-span-2"
						/>
						<Field
							label="City"
							value={header.city}
							onChange={(v) => setField("city", v)}
						/>
						<div className="grid grid-cols-2 gap-3">
							<Field
								label="State"
								value={header.state}
								onChange={(v) => setField("state", v)}
							/>
							<Field
								label="ZIP"
								value={header.zip}
								onChange={(v) => setField("zip", v)}
							/>
						</div>
					</div>
				</div>

				{/* Prices */}
				<div className="rounded-2xl border border-neutral-200 bg-white/80 p-5 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/70">
					<div className="mb-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
						Prices
					</div>
					<p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
						Enter a price only for the products you want to quote — blanks are left
						out. Entering <span className="font-medium">OS-MON-1604</span> (single
						4g unit) also adds the 16g 4-pack at 4× that price.
					</p>
					<div className="divide-y divide-neutral-100 dark:divide-neutral-800">
						{QUOTE_INPUTS.map((p) => (
							<div key={p.id} className="flex items-center gap-3 py-2.5">
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
										{p.code}
									</div>
									<div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
										{p.label}
									</div>
								</div>
								<div className="relative w-32 shrink-0">
									<span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
										$
									</span>
									<input
										inputMode="decimal"
										value={prices[p.id] ?? ""}
										onChange={(e) => setPrice(p.id, e.target.value)}
										className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-6 pr-2 text-right text-sm tabular-nums text-neutral-800 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
									/>
								</div>
							</div>
						))}
					</div>
				</div>

				{error && <p className="text-sm text-red-500">{error}</p>}

				<div className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={handleDownloadQuote}
						disabled={isGenerating}
						className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
					>
						{isGenerating ? "Generating…" : "Generate PDF"}
					</button>
					<span className="text-xs text-neutral-500 dark:text-neutral-400">
						{filledCount} product{filledCount === 1 ? "" : "s"} priced
					</span>

					{pdf && (
						<a
							href={pdf.url}
							download={pdf.fileName}
							target="_blank"
							rel="noopener"
							className="ml-auto rounded-xl border border-emerald-500 bg-emerald-50 px-5 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
						>
							Download “{pdf.fileName}”
						</a>
					)}
				</div>

				{pdf && (
					<p className="text-xs text-neutral-500 dark:text-neutral-400">
						If nothing downloaded automatically, right-click (two-finger click)
						the green link and choose “Download Linked File”.
					</p>
				)}
			</div>

			<p className="mt-4 text-xs text-neutral-400">
				The quote keeps the template’s exact layout — today’s date, an expiration
				one month out, your hospital and address, and only the products you
				priced. One click downloads “[hospital name] quote.pdf”. Everything runs
				in your browser; nothing is uploaded.
			</p>
		</div>
	);
}
