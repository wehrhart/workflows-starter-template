/**
 * Shipping-sheet photo extraction (local OCR via tesseract.js — nothing
 * leaves the machine). Calibrated against a real FedEx US Airbill photo:
 *
 *  • Tracking number: the typed 12-digit number reads reliably — but only
 *    with a digits-only, single-line OCR pass over a small box. The full-page
 *    pass garbles it. So we grid-scan candidate boxes across the top of the
 *    photo and take the first clean 12-digit run.
 *  • Top-right handwritten codes ("1G 1C 2T 3M" — quantities may be written
 *    number-first or letter-first): same trick, whitelist-restricted boxes
 *    over the top-right area. Handwriting OCR is imperfect (a character can
 *    drop out) — the review page exists to fix that.
 *  • Handwritten rep name: local OCR generally CANNOT read handwriting on
 *    these carbon-copy sheets. We try label-anchored patterns on the
 *    full-page text, apply a sanity filter, and return "" rather than
 *    garbage — the user types the name on the review page.
 *  • HEIC (iPhone photo format) is decoded locally via heic-decode.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import Tesseract from "tesseract.js";
import { KAIRUKU_DATA_DIR } from "./overageSheet.ts";

export interface ShippingSheetQuantities {
	montage: number | null;
	cartridge: number | null;
	gun: number | null;
	tips: number | null;
	hemasorb: number | null;
	hemasorbApply: number | null;
	permatage: number | null;
}

export interface ShippingSheetExtraction {
	trackingNumber: string;
	repName: string;
	quantities: ShippingSheetQuantities;
	/** Full OCR text, for eyeballing what the reader saw. */
	rawText: string;
	/** Which reader produced this: Claude vision (near-perfect, needs an API key) or local OCR. */
	reader: "claude" | "local";
	/** One-line note for the review page (e.g. why fields are blank). */
	readerNote?: string;
}

// ---------------------------------------------------------------------------
// Image handling: sniff type, get dimensions, decode HEIC → PNG
// ---------------------------------------------------------------------------

function pngFromRgb(width: number, height: number, rgb: Uint8Array): Buffer {
	const chunk = (tag: string, payload: Buffer): Buffer => {
		const body = Buffer.concat([Buffer.from(tag, "ascii"), payload]);
		const len = Buffer.alloc(4);
		len.writeUInt32BE(payload.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body) >>> 0);
		return Buffer.concat([len, body, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // color type RGB
	const stride = width * 3;
	const scan = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		scan[y * (stride + 1)] = 0; // filter: none
		scan.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(scan, { level: 6 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function isHeic(buf: Buffer): boolean {
	if (buf.length < 12 || buf.toString("ascii", 4, 8) !== "ftyp") return false;
	const brand = buf.toString("ascii", 8, 12);
	return /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand);
}

function imageSize(buf: Buffer): { width: number; height: number } | null {
	// PNG
	if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
		return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
	}
	// JPEG: scan for a SOF marker
	if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
		let i = 2;
		while (i + 9 < buf.length) {
			if (buf[i] !== 0xff) {
				i++;
				continue;
			}
			const marker = buf[i + 1];
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
				return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
			}
			const len = buf.readUInt16BE(i + 2);
			i += 2 + len;
		}
	}
	return null;
}

/** Accepts JPG/PNG as-is; converts HEIC (iPhone) to PNG. */
async function normalizeImage(
	buf: Buffer,
): Promise<{ image: Buffer; width: number | null; height: number | null }> {
	if (isHeic(buf)) {
		const { default: decode } = await import("heic-decode");
		const { width, height, data } = await decode({ buffer: buf });
		const rgba = new Uint8Array(data);
		const rgb = new Uint8Array(width * height * 3);
		for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
			rgb[j] = rgba[i];
			rgb[j + 1] = rgba[i + 1];
			rgb[j + 2] = rgba[i + 2];
		}
		return { image: pngFromRgb(width, height, rgb), width, height };
	}
	const size = imageSize(buf);
	return { image: buf, width: size?.width ?? null, height: size?.height ?? null };
}

// ---------------------------------------------------------------------------
// OCR worker
// ---------------------------------------------------------------------------

let workerPromise: Promise<Tesseract.Worker> | null = null;

/** One shared OCR worker; language data is cached after the first run. */
function getWorker(): Promise<Tesseract.Worker> {
	if (!workerPromise) {
		workerPromise = Tesseract.createWorker("eng", 1, {
			cachePath: KAIRUKU_DATA_DIR,
			logger: () => {},
		});
	}
	return workerPromise;
}

interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

async function ocrBox(
	image: Buffer,
	box: Box | null,
	whitelist: string,
	psm: string,
): Promise<string> {
	const worker = await getWorker();
	await worker.setParameters({
		tessedit_char_whitelist: whitelist,
		tessedit_pageseg_mode: psm as Tesseract.PSM,
	});
	const { data } = await worker.recognize(image, box ? { rectangle: box } : {});
	return data.text ?? "";
}

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

const twelveDigits = (text: string): string => {
	const joined = text.replace(/(\d)[ \t](?=\d)/g, "$1");
	const m = joined.match(/\b(\d{12})\b/);
	return m ? m[1] : "";
};

/**
 * The typed tracking number sits in the top area of the sheet. Grid-scan
 * digit-only single-line boxes (center first — that's where airbill tracking
 * numbers live) and take the first clean 12-digit run.
 */
async function findTrackingNumber(
	image: Buffer,
	w: number | null,
	h: number | null,
	fullText: string,
): Promise<string> {
	// A wrong-but-plausible tracking number silently saved into Kairuku is far
	// worse than a blank one the user types. Acceptance gate: FedEx 12-digit
	// tracking numbers carry a check digit (weights 1,3,7 right-to-left over
	// the first 11 digits, sum mod 11 = 12th digit — verified against a real
	// airbill). OCR noise adds stray digits around the number, so every
	// 12-digit window of each digit run is tried; only a window that PASSES
	// the checksum is accepted. Misreads fail it (~91% detection), and a
	// candidate that fails is never guessed — blank means "type it".
	const fedexChecksumOk = (d: string): boolean => {
		const weights = [1, 3, 7];
		let sum = 0;
		for (let i = 0; i < 11; i++) {
			sum += Number(d[10 - i]) * weights[i % 3];
		}
		const r = sum % 11;
		return (r === 10 ? 0 : r) === Number(d[11]);
	};
	const cast = (text: string): string | null => {
		const joined = text.replace(/(\d)[ \t](?=\d)/g, "$1");
		for (const run of joined.match(/\d{12,15}/g) ?? []) {
			for (let i = 0; i + 12 <= run.length; i++) {
				const window = run.slice(i, i + 12);
				if (fedexChecksumOk(window)) return window;
			}
		}
		return null;
	};
	if (w && h) {
		// Narrow single-line (psm 7) boxes; center columns first — airbill
		// tracking numbers sit top-center. Geometry calibrated on a real photo
		// (the winning box there: x 32%, y 10%, w 30%, h 5%). The checksum
		// gate means scanning many boxes can only help, never hurt.
		const cols: Array<[number, number]> = [
			[0.32, 0.3],
			[0.35, 0.26],
			[0.28, 0.3],
			[0.42, 0.26],
			[0.5, 0.26],
			[0.15, 0.3],
		];
		const rows = [0.1, 0.07, 0.13, 0.04, 0.16, 0.2];
		for (const ry of rows) {
			for (const [rx, rw] of cols) {
				const box: Box = {
					left: Math.round(w * rx),
					top: Math.round(h * ry),
					width: Math.min(Math.round(w * rw), w - Math.round(w * rx)),
					height: Math.round(h * 0.05),
				};
				const text = await ocrBox(image, box, "0123456789 ", "7").catch(() => "");
				const found = cast(text);
				if (found) return found;
			}
		}
	}
	return cast(fullText) ?? "";
}

/**
 * Top-right handwritten quantities. Real sheets have them written EITHER
 * way: "3M 2T" (number first) or "M3 / M 3" (letter first). HA is matched
 * before H. Only text from the dedicated top-right boxes is parsed — the
 * full-page text is full of printed-form noise ("2Day", section numbers)
 * that produced false positives.
 */
function parseCodes(text: string, q: ShippingSheetQuantities) {
	const keyByLabel: Record<string, keyof ShippingSheetQuantities> = {
		M: "montage",
		C: "cartridge",
		G: "gun",
		T: "tips",
		H: "hemasorb",
		HA: "hemasorbApply",
		P: "permatage",
	};
	// Number-first: a single digit immediately (or one space) before the code.
	// Codes may be written run-together ("1C2T3M"), so a digit after the code
	// letter is fine — only another LETTER disqualifies (e.g. P in "Payment").
	for (const m of text.matchAll(/(\d)\s?(HA|[MCGTHP])(?![A-Z])/gi)) {
		const key = keyByLabel[m[2].toUpperCase()];
		if (key && q[key] === null) q[key] = Number(m[1]);
	}
	// Letter-first: code then a 1–2 digit number.
	for (const m of text.matchAll(/\b(HA|[MCGTHP])\s?(\d{1,2})\b/gi)) {
		const key = keyByLabel[m[1].toUpperCase()];
		if (key && q[key] === null) q[key] = Number(m[2]);
	}
}

async function findQuantities(
	image: Buffer,
	w: number | null,
	h: number | null,
): Promise<ShippingSheetQuantities> {
	const q: ShippingSheetQuantities = {
		montage: null,
		cartridge: null,
		gun: null,
		tips: null,
		hemasorb: null,
		hemasorbApply: null,
		permatage: null,
	};
	if (!w || !h) return q;
	const boxes: Box[] = [];
	for (const ry of [0.04, 0.09, 0.01, 0.14]) {
		for (const rx of [0.55, 0.68, 0.45, 0.8]) {
			boxes.push({
				left: Math.round(w * rx),
				top: Math.round(h * ry),
				width: Math.min(Math.round(w * 0.34), w - Math.round(w * rx)),
				height: Math.round(h * 0.08),
			});
		}
	}
	// Handwriting OCR flips wildly with small crop shifts, so pre-fill ONLY
	// from a high-signal read: a single box that yields 3+ distinct codes in
	// one pass (e.g. "1C2T3M"). One- or two-code reads are as likely to be
	// noise as signal — leave the boxes blank and let the user type them.
	for (const box of boxes) {
		for (const psm of ["7", "6"]) {
			const text = await ocrBox(image, box, "0123456789GCTMHAP ", psm).catch(() => "");
			if (!text.trim()) continue;
			const candidate: ShippingSheetQuantities = { ...q };
			// The read must be MOSTLY code pairs: after removing them, almost
			// nothing may remain. Junk crops ("1 2 9 7 PT 4 0215") can match a
			// few pairs by accident but always leave digit soup behind.
			const residual = text
				.replace(/(\d)\s?(HA|[MCGTHP])(?![A-Z])/gi, "")
				.replace(/\b(HA|[MCGTHP])\s?(\d{1,2})\b/gi, "")
				.replace(/[^0-9A-Z]/gi, "");
			if (residual.length > 2) continue;
			parseCodes(text, candidate);
			if (Object.values(candidate).filter((v) => v !== null).length >= 3) {
				return candidate;
			}
		}
	}
	return q;
}

/**
 * The handwritten name usually follows a label like "Recipient's Name",
 * "Ship to", "Attn", "Name", or "To". Handwriting is often invisible to
 * local OCR — a sanity filter keeps printed-form noise from being returned
 * as a "name"; when in doubt this returns "" and the user types it.
 */
function findRepName(text: string): string {
	const candidates: string[] = [];
	for (const line of text.split("\n")) {
		const m = line.match(
			/^\s*(?:recipient'?s?\s*name|ship\s*to|attn|name|to)\b[:.\-\s]*(.+)$/i,
		);
		if (m) candidates.push(m[1]);
	}
	for (const raw of candidates) {
		const cleaned = raw.replace(/[^A-Za-z' .-]/g, " ").replace(/\s+/g, " ").trim();
		const words = cleaned.split(" ").filter((x) => x.length >= 2);
		// A believable name: 2–4 words, letters only, no form vocabulary.
		if (
			words.length >= 2 &&
			words.length <= 4 &&
			!/phone|company|address|city|state|account|sender|hold|package|internal|billing/i.test(
				cleaned,
			)
		) {
			return words.join(" ");
		}
	}
	return "";
}

// ---------------------------------------------------------------------------
// Claude vision reader (optional, near-perfect — reads the handwriting too).
// Activated by an Anthropic API key, from either the ANTHROPIC_API_KEY env
// var or a one-line file at ~/.abyrx-kairuku/anthropic-api-key.txt.
// Only the shipping-sheet photo is sent to the Claude API; costs pennies per
// sheet. Without a key, the fully local OCR below runs instead.
// ---------------------------------------------------------------------------

const KEY_FILE = path.join(os.homedir(), ".abyrx-kairuku", "anthropic-api-key.txt");

function getAnthropicKey(): string | null {
	if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
	try {
		const key = readFileSync(KEY_FILE, "utf8").trim();
		return key || null;
	} catch {
		return null;
	}
}

const VISION_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["trackingNumber", "repName", "quantities"],
	properties: {
		trackingNumber: {
			type: "string",
			description: "The typed 12-digit FedEx tracking number, digits only. Empty string if not readable.",
		},
		repName: {
			type: "string",
			description: "The handwritten recipient name from section 3 (To / Recipient's Name), as 'First Last'. Empty string if not readable.",
		},
		quantities: {
			type: "object",
			additionalProperties: false,
			required: ["M", "C", "G", "T", "H", "HA", "P"],
			properties: Object.fromEntries(
				["M", "C", "G", "T", "H", "HA", "P"].map((k) => [
					k,
					{ anyOf: [{ type: "integer" }, { type: "null" }] },
				]),
			),
		},
	},
} as const;

async function tryClaudeVision(
	image: Buffer,
): Promise<ShippingSheetExtraction | null> {
	const apiKey = getAnthropicKey();
	if (!apiKey) return null;

	const { default: Anthropic } = await import("@anthropic-ai/sdk");
	const client = new Anthropic({ apiKey });
	const mediaType = image[0] === 0x89 ? "image/png" : "image/jpeg";

	const response = await client.messages.create({
		model: "claude-opus-4-8",
		max_tokens: 4096,
		thinking: { type: "adaptive" },
		output_config: {
			format: { type: "json_schema", schema: VISION_SCHEMA as Record<string, unknown> },
		},
		messages: [
			{
				role: "user",
				content: [
					{
						type: "image",
						source: { type: "base64", media_type: mediaType, data: image.toString("base64") },
					},
					{
						type: "text",
						text:
							"This is a photo of a FedEx US Airbill shipping sheet. Extract exactly three things:\n" +
							"1. trackingNumber — the TYPED 12-digit FedEx tracking number printed near the top (often spaced '#### #### ####'; return digits only).\n" +
							"2. repName — the HANDWRITTEN recipient name in section 3 ('To' / 'Recipient's Name'), as 'First Last'.\n" +
							"3. quantities — handwritten codes in the top-right area pairing a quantity with a letter code: M, C, G, T, H, HA, or P. They may be written number-first ('3M') or letter-first ('M3'). Set a code's value to its number, and null for any code not written. Match HA before H.\n" +
							"Read carefully; if something is truly illegible, use empty string / null rather than guessing.",
					},
				],
			},
		],
	});

	if (response.stop_reason === "refusal") {
		throw new Error("The vision reader declined this image.");
	}
	const textBlock = response.content.find((b) => b.type === "text");
	if (!textBlock || textBlock.type !== "text") {
		throw new Error("The vision reader returned no text.");
	}
	const parsed = JSON.parse(textBlock.text) as {
		trackingNumber: string;
		repName: string;
		quantities: Record<string, number | null>;
	};

	const num = (v: unknown): number | null =>
		typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1000
			? Math.round(v)
			: null;
	let tracking = (parsed.trackingNumber ?? "").replace(/\D/g, "");
	if (tracking.length !== 12) tracking = "";
	return {
		trackingNumber: tracking,
		repName: (parsed.repName ?? "").replace(/\s+/g, " ").trim(),
		quantities: {
			montage: num(parsed.quantities?.M),
			cartridge: num(parsed.quantities?.C),
			gun: num(parsed.quantities?.G),
			tips: num(parsed.quantities?.T),
			hemasorb: num(parsed.quantities?.H),
			hemasorbApply: num(parsed.quantities?.HA),
			permatage: num(parsed.quantities?.P),
		},
		rawText: "(read by Claude vision)",
		reader: "claude",
	};
}

// ---------------------------------------------------------------------------

export async function extractShippingSheet(
	imageBuffer: Buffer,
): Promise<ShippingSheetExtraction> {
	const { image, width, height } = await normalizeImage(imageBuffer);

	// Prefer Claude vision when a key is configured — it reads the handwriting.
	let visionNote: string | undefined;
	try {
		const vision = await tryClaudeVision(image);
		if (vision) return vision;
	} catch (err) {
		const msg = err instanceof Error ? err.message.split("\n")[0] : "unknown error";
		console.log(`[demo-units] vision reader failed, using local OCR: ${msg}`);
		visionNote = `Claude vision reader failed (${msg}) — used the local reader instead.`;
	}

	// Local OCR fallback: fully offline, safe-blanks-over-guesses.
	const fullText = await ocrBox(image, null, "", "3").catch(() => "");
	const trackingNumber = await findTrackingNumber(image, width, height, fullText);
	const quantities = await findQuantities(image, width, height);
	return {
		trackingNumber,
		repName: findRepName(fullText),
		quantities,
		rawText: fullText,
		reader: "local",
		readerNote:
			visionNote ??
			"Read locally — the typed tracking number auto-fills when certain; handwriting usually needs typing. For near-perfect auto-fill, add a Claude API key (see the README).",
	};
}
