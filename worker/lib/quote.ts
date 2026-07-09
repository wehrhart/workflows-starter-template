/**
 * Price Quote tool — pure logic, no DOM.
 *
 * The product catalog below is the single source of truth for the quote: the
 * form lists an input for every purchasable option, and the PDF renders these
 * exact rows in this exact order. It mirrors the ABYRX quote template
 * (Quote_temp.docx) byte-for-byte: codes, qty labels, descriptions and the
 * default list prices are copied straight from that document.
 *
 * The one wrinkle is OS-MON-1604. The template carries two 1604 rows — a single
 * 4g unit (the price you enter) and a 16g Multi-Pack of 4 units. You only ever
 * quote the single-unit price; the multi-pack is derived as 4× that price. So
 * the multi-pack is a `derived` catalog entry (no form input of its own) that is
 * included whenever the single unit is filled in.
 */

/** A catalog entry that takes a price directly from the form. */
export interface InputProduct {
	kind: "input";
	/** Stable id used as the form field key. */
	id: string;
	/** Item # column text, exactly as printed in the template. */
	code: string;
	/** Qty column text (e.g. "1 each", "1 pack"). */
	qty: string;
	/** Description column text, exactly as printed. */
	description: string;
	/** Short label shown next to the price input in the form. */
	label: string;
	/** Template list price, shown as a placeholder / reference. */
	defaultPrice: number;
}

/** A catalog entry whose price is derived from another entry (× multiplier). */
export interface DerivedProduct {
	kind: "derived";
	id: string;
	code: string;
	qty: string;
	description: string;
	/** Id of the InputProduct this derives from. */
	deriveFromId: string;
	/** Multiplier applied to the source price (the 4-pack is ×4). */
	multiplier: number;
	defaultPrice: number;
}

export type CatalogProduct = InputProduct | DerivedProduct;

/**
 * Every product in the template, in the template's row order. Do not reorder —
 * the PDF prints filled rows in this sequence to match the source document.
 */
export const QUOTE_CATALOG: CatalogProduct[] = [
	{
		kind: "input",
		id: "OS-MON-1001",
		code: "OS-MON-1001",
		qty: "1 each",
		label: "MONTAGE (10g) Unit",
		description:
			"MONTAGE (10g) Unit(Settable, Resorbable, Hemostatic (bone), Cohesive, Adheres to bone, Synthetic (tissue-free), Hydroxyapatite/βeta-Tricalcium Phosphate)",
		defaultPrice: 1748,
	},
	{
		kind: "input",
		id: "OS-MON-1001FS",
		code: "OS-MON-1001FS",
		qty: "1 each",
		label: "MONTAGE Fast Set (10g) Unit",
		description:
			"MONTAGE Fast Set (10g) Unit (Settable, Resorbable, Hemostatic (bone), Cohesive, Adheres to bone, Synthetic (tissue-free), Hydroxyapatite/βeta-Tricalcium Phosphate)",
		defaultPrice: 1748,
	},
	{
		kind: "derived",
		id: "OS-MON-1604-4PACK",
		code: "OS-MON-1604",
		qty: "1 pack",
		description:
			"MONTAGE 16g Multi-Pack (4x4g Units)(Settable, Resorbable, Hemostatic (bone), Cohesive, Adheres to bone, Synthetic (tissue-free), Hydroxyapatite/βeta-Tricalcium Phosphate)",
		deriveFromId: "OS-MON-1604",
		multiplier: 4,
		defaultPrice: 3332,
	},
	{
		kind: "input",
		id: "OS-MON-1501FL",
		code: "OS-MON-1501FL",
		qty: "1 each",
		label: "MONTAGE Flowable (15g) Unit",
		description:
			"MONTAGE Flowable (15g) Unit(Settable, Resorbable, Hemostatic (bone) paste, Synthetic (tissue-free), Hydroxyapatite/βeta-Tricalcium Phosphate)",
		defaultPrice: 2812,
	},
	{
		kind: "input",
		id: "OS-MON-1604",
		code: "OS-MON-1604*(MONTAGE 2cc each only available on bill only basis)",
		qty: "1 each",
		label: "MONTAGE (4g) Unit — single (also drives the 16g 4-pack ×4)",
		description:
			"MONTAGE (4g) Unit(Settable, Resorbable, Hemostatic (bone), Cohesive, Adheres to bone, Synthetic (tissue-free), Hydroxyapatite/βeta-Tricalcium Phosphate)",
		defaultPrice: 833,
	},
	{
		kind: "input",
		id: "OS-PER-1001",
		code: "OS-PER-1001",
		qty: "1 each",
		label: "PERMATAGE (10g) Unit",
		description:
			"PERMATAGE (10g) Unit(Settable, Non-Absorbable, Hemostatic (bone), Cohesive, Adheres to bone, Synthetic (tissue-free),Hydroxyapatite/βeta-Tricalcium Phosphate)",
		defaultPrice: 2214,
	},
	{
		kind: "input",
		id: "OS-MON-1401CT",
		code: "OS-MON-1401CT",
		qty: "1 each",
		label: "MONTAGE CT Sternum (14g) Unit",
		description:
			"MONTAGE CT Sternum (14g) Unit (Settable, Resorbable, Hemostatic (bone), Cohesive, Adheres to bone, Synthetic (tissue-free), Hydroxyapatite/βeta-Tricalcium Phosphate)",
		defaultPrice: 1433,
	},
	{
		kind: "input",
		id: "OS-401",
		code: "OS-401",
		qty: "1 each",
		label: "Hemasorb 4g (2x2)",
		description: "Hemasorb 4g (2x2)Resorbable Hemostatic Bone Putty",
		defaultPrice: 224,
	},
	{
		kind: "input",
		id: "OS-201",
		code: "OS-201",
		qty: "1 each",
		label: "Hemasorb 2g with spatula",
		description: "Hemasorb 2g with spatula Resorbable Hemostatic Bone Putty",
		defaultPrice: 263,
	},
	{
		kind: "input",
		id: "OSA-351",
		code: "OSA-351",
		qty: "1 each",
		label: "HEMASORB apply 3.5g",
		description: "HEMASORB apply 3.5g(Resorbable, synthetic, hemostatic bone putty)",
		defaultPrice: 289,
	},
	{
		kind: "input",
		id: "OS-MON-1001XT",
		code: "OS-MON-1001XT",
		qty: "1 each",
		label: "MONTAGE XT (10 gram unit)",
		description:
			"MONTAGE XT (10 gram unit) (Settable, Resorbable, Hemostatic (bone), Cohesive, Adheres to bone, Synthetic (tissue-free), Hydroxyapatite/βeta-Tricalcium Phosphate)",
		defaultPrice: 2246,
	},
	{
		kind: "input",
		id: "OS-PER-2001",
		code: "OS-PER-2001",
		qty: "1 each",
		label: "PERMATAGE (20g) Unit",
		description:
			"PERMATAGE (20g) Unit(Settable, Non-Absorbable, Hemostatic (bone), Cohesive, Adheres to bone, Synthetic (tissue-free),Hydroxyapatite/βeta-Tricalcium Phosphate)",
		defaultPrice: 5233,
	},
];

/** The form fields the user fills in — one per input product, in catalog order. */
export const QUOTE_INPUTS: InputProduct[] = QUOTE_CATALOG.filter(
	(p): p is InputProduct => p.kind === "input",
);

/** Buyer/header details for the quote. */
export interface QuoteHeader {
	hospitalName: string;
	streetAddress: string;
	city: string;
	state: string;
	zip: string;
}

/** A single line printed in the quote's item table. */
export interface QuoteLine {
	qty: string;
	code: string;
	description: string;
	/** Numeric price (already ×4 for the derived multi-pack). */
	price: number;
	/** Formatted price, e.g. "$1,748.00". */
	priceText: string;
	/** True for the derived 16g multi-pack. */
	derived: boolean;
}

/** The fully-resolved quote, ready to render to PDF. */
export interface Quote {
	hospitalName: string;
	/** "To" block lines: hospital, street, "City, ST ZIP" (blank lines dropped). */
	toLines: string[];
	dateText: string; // e.g. "July 9, 2026"
	expirationText: string; // one month after dateText
	lines: QuoteLine[];
	/** Suggested download filename, e.g. "Jackson Health System quote.pdf". */
	fileName: string;
}

/** Prices entered in the form, keyed by InputProduct.id. Blank/omitted = excluded. */
export type PriceMap = Record<string, number | null | undefined>;

const MONTHS = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];

/** Format a Date as "Month D, YYYY" (no leading zero), matching the template. */
export function formatQuoteDate(d: Date): string {
	return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * One calendar month after `d`. If the day overflows the target month (e.g.
 * Jan 31 → Feb), clamp to that month's last day.
 */
export function oneMonthAfter(d: Date): Date {
	const day = d.getDate();
	const target = new Date(d.getFullYear(), d.getMonth() + 1, 1);
	const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
	target.setDate(Math.min(day, lastDay));
	return target;
}

/** Format a number as US currency, e.g. 1748 → "$1,748.00". */
export function formatMoney(n: number): string {
	const sign = n < 0 ? "-" : "";
	const abs = Math.abs(n);
	const [whole, frac] = abs.toFixed(2).split(".");
	const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	return `${sign}$${withCommas}.${frac}`;
}

/** Parse a user-typed price ("$1,748.00", "1748", "1,748") into a number, or null. */
export function parsePrice(raw: unknown): number | null {
	if (raw == null) return null;
	const s = String(raw).replace(/[$,\s]/g, "").trim();
	if (s === "") return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

/** Build the "To" block: hospital, street, "City, ST ZIP" — dropping blanks. */
export function buildToLines(h: QuoteHeader): string[] {
	const cityLine = [h.city.trim(), [h.state.trim(), h.zip.trim()].filter(Boolean).join(" ")]
		.filter(Boolean)
		.join(", ");
	return [h.hospitalName.trim(), h.streetAddress.trim(), cityLine].filter((l) => l.length > 0);
}

/**
 * Resolve a filled-in form into a Quote. `prices` maps InputProduct.id → price;
 * only products with a numeric price are included. The derived 16g multi-pack is
 * included whenever its source single unit (OS-MON-1604) is priced, at ×4.
 * `today` is injected so callers/tests control the date; defaults to now.
 */
export function buildQuote(
	header: QuoteHeader,
	prices: PriceMap,
	today: Date = new Date(),
): Quote {
	const lines: QuoteLine[] = [];

	for (const product of QUOTE_CATALOG) {
		let price: number | null = null;
		if (product.kind === "input") {
			price = parsePrice(prices[product.id]);
		} else {
			const source = parsePrice(prices[product.deriveFromId]);
			price = source == null ? null : source * product.multiplier;
		}
		if (price == null) continue;

		lines.push({
			qty: product.qty,
			code: product.code,
			description: product.description,
			price,
			priceText: formatMoney(price),
			derived: product.kind === "derived",
		});
	}

	const name = header.hospitalName.trim();
	return {
		hospitalName: name,
		toLines: buildToLines(header),
		dateText: formatQuoteDate(today),
		expirationText: formatQuoteDate(oneMonthAfter(today)),
		lines,
		fileName: `${name || "Untitled"} quote.pdf`,
	};
}
