import type { BillSheet, ProductLine } from "./types";

/**
 * Extraction model. Llama 3.3 handles the mixed label/table layout of a bill
 * sheet well and supports JSON-schema-constrained output on Workers AI.
 */
const EXTRACT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const EXTRACT_SCHEMA = {
	type: "object",
	properties: {
		caseId: {
			type: ["string", "null"],
			description:
				"The Case ID under 'Case Details'. null if that field is blank/absent.",
		},
		surgeryDate: {
			type: ["string", "null"],
			description: "Date of Surgery, formatted MM/DD/YYYY.",
		},
		surgeonName: { type: ["string", "null"] },
		procedure: { type: ["string", "null"] },
		hospitalName: { type: ["string", "null"] },
		repName: { type: ["string", "null"], description: "Distributor/Rep name." },
		repEmail: { type: ["string", "null"] },
		shippingAddress: { type: ["string", "null"] },
		shippingZip: {
			type: ["string", "null"],
			description: "5-digit zip from the shipping address.",
		},
		products: {
			type: "array",
			items: {
				type: "object",
				properties: {
					productNumber: { type: "string" },
					description: { type: "string" },
					unitsUsed: { type: "number" },
					pricePerUnit: { type: "number" },
					totalPrice: { type: "number" },
					lotNumber: { type: ["string", "null"] },
				},
				required: ["productNumber", "description"],
			},
		},
	},
	required: ["caseId", "products"],
} as const;

const SYSTEM_PROMPT = `You extract structured data from a medical device "bill sheet" (a.k.a. bill only sheet).
Return ONLY the fields in the schema. Rules:
- Case ID lives under the "Case Details" section. If it is blank or absent, return null — do NOT invent one.
- surgeryDate must be MM/DD/YYYY.
- Each row of the "Product Usage Information" table is one product line: product number, description, units used, price per unit, total price, lot number.
- Numbers must be plain numbers (strip $ and thousands separators).
- shippingZip is the 5-digit zip from the Shipping Address.`;

/** Convert a document (PDF) to markdown text using Workers AI. */
export async function pdfToMarkdown(
	env: Env,
	fileName: string,
	bytes: Uint8Array,
): Promise<string> {
	const results = await env.AI.toMarkdown([
		{ name: fileName, blob: new Blob([bytes]) },
	]);
	const first = Array.isArray(results) ? results[0] : results;
	if (first && first.format === "markdown") return first.data;
	throw new Error(
		first && first.format === "error"
			? `Could not read ${fileName}: ${first.error}`
			: `Could not read ${fileName}`,
	);
}

/** Run the LLM extraction over bill-sheet markdown. */
export async function extractFromMarkdown(
	env: Env,
	markdown: string,
): Promise<Partial<BillSheet>> {
	const resp = (await env.AI.run(EXTRACT_MODEL, {
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: markdown },
		],
		response_format: {
			type: "json_schema",
			json_schema: EXTRACT_SCHEMA,
		},
		// deterministic-ish extraction
		temperature: 0,
	})) as { response?: unknown };

	const raw = resp?.response;
	const obj = typeof raw === "string" ? safeJson(raw) : (raw as object | null);
	return (obj ?? {}) as Partial<BillSheet>;
}

/** Full pipeline: PDF bytes -> normalized BillSheet. */
export async function extractBillSheet(
	env: Env,
	fileName: string,
	bytes: Uint8Array,
): Promise<BillSheet> {
	const markdown = await pdfToMarkdown(env, fileName, bytes);
	const partial = await extractFromMarkdown(env, markdown);
	return normalizeBillSheet(partial, fileName);
}

function safeJson(s: string): object | null {
	try {
		return JSON.parse(s);
	} catch {
		const m = s.match(/\{[\s\S]*\}/);
		if (m) {
			try {
				return JSON.parse(m[0]);
			} catch {
				return null;
			}
		}
		return null;
	}
}

const US_ZIP = /\b(\d{5})(?:-\d{4})?\b/;

/** Coerce a date string into MM/DD/YYYY when possible. */
export function normalizeDate(d: string | null | undefined): string | null {
	if (!d) return null;
	const s = String(d).trim();
	const m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
	if (m) {
		const mm = m[1].padStart(2, "0");
		const dd = m[2].padStart(2, "0");
		let yyyy = m[3];
		if (yyyy.length === 2) yyyy = `20${yyyy}`;
		return `${mm}/${dd}/${yyyy}`;
	}
	return s;
}

/** Fill in / clean derived fields the model may have missed. */
export function normalizeBillSheet(
	partial: Partial<BillSheet>,
	fileName: string,
): BillSheet {
	const caseId = partial.caseId?.toString().trim();
	const shippingAddress = partial.shippingAddress?.toString().trim() ?? null;
	let zip = partial.shippingZip?.toString().trim() ?? null;
	if (!zip && shippingAddress) {
		const m = shippingAddress.match(US_ZIP);
		if (m) zip = m[1];
	}
	if (zip) zip = zip.slice(0, 5);

	const products: ProductLine[] = (partial.products ?? [])
		.filter((p) => p && p.productNumber)
		.map((p) => ({
			productNumber: String(p.productNumber).trim(),
			description: String(p.description ?? "").trim(),
			unitsUsed: toNum(p.unitsUsed, 1),
			pricePerUnit: toNum(p.pricePerUnit, 0),
			totalPrice: toNum(
				p.totalPrice,
				toNum(p.unitsUsed, 1) * toNum(p.pricePerUnit, 0),
			),
			lotNumber: p.lotNumber ? String(p.lotNumber).trim() : undefined,
		}));

	return {
		sourceFile: fileName,
		caseId: caseId && caseId.length > 0 ? caseId : null,
		surgeryDate: normalizeDate(partial.surgeryDate),
		surgeonName: nn(partial.surgeonName),
		procedure: nn(partial.procedure),
		hospitalName: nn(partial.hospitalName),
		repName: nn(partial.repName),
		repEmail: nn(partial.repEmail),
		shippingAddress,
		shippingZip: zip,
		products,
	};
}

function toNum(v: unknown, fallback: number): number {
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string") {
		const n = parseFloat(v.replace(/[$,]/g, ""));
		if (Number.isFinite(n)) return n;
	}
	return fallback;
}

function nn(v: unknown): string | null {
	const s = v == null ? "" : String(v).trim();
	return s.length ? s : null;
}
