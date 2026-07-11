/**
 * Shipping-sheet photo extraction (local OCR via tesseract.js — nothing
 * leaves the machine). Best-effort by design: the typed 12-digit tracking
 * number reads reliably; the handwritten rep name and the handwritten
 * top-right quantities (M, C, G, T, H, HA, P) are a starting point that the
 * review page lets the user correct before anything runs.
 */

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
}

let workerPromise: Promise<Tesseract.Worker> | null = null;

/** One shared OCR worker; language data is cached in .kairuku-data/ after the first run. */
function getWorker(): Promise<Tesseract.Worker> {
	if (!workerPromise) {
		workerPromise = Tesseract.createWorker("eng", 1, {
			cachePath: KAIRUKU_DATA_DIR,
			// Tesseract logs progress objects; keep the console quiet.
			logger: () => {},
		});
	}
	return workerPromise;
}

/** 12-digit tracking number; tolerate OCR splitting digit runs with spaces. */
function findTrackingNumber(text: string): string {
	const joined = text.replace(/(\d)[ \t](?=\d)/g, "$1");
	const m = joined.match(/\b(\d{12})\b/);
	return m ? m[1] : "";
}

/**
 * The handwritten name usually follows a label like "Name", "To", "Attn",
 * or "Ship to". Take the rest of that line; otherwise leave blank for the
 * user to type on the review page.
 */
function findRepName(text: string): string {
	for (const line of text.split("\n")) {
		const m = line.match(/^\s*(?:ship\s*to|attn|name|to)\b[:.\-\s]*(.+)$/i);
		if (m) {
			const candidate = m[1].replace(/[^A-Za-z' .-]/g, " ").replace(/\s+/g, " ").trim();
			// A real name has at least two words of letters.
			if (/^[A-Za-z][A-Za-z' .-]+\s+[A-Za-z]/.test(candidate)) return candidate;
		}
	}
	return "";
}

/**
 * Top-right handwritten quantities, written as label + number:
 *   M 2   C 1   G 1   T 2   H 1   HA 1   P 3
 * HA must be matched before H so "HA 1" doesn't read as H=A1.
 */
function findQuantities(text: string): ShippingSheetQuantities {
	const q: ShippingSheetQuantities = {
		montage: null,
		cartridge: null,
		gun: null,
		tips: null,
		hemasorb: null,
		hemasorbApply: null,
		permatage: null,
	};
	const keyByLabel: Record<string, keyof ShippingSheetQuantities> = {
		M: "montage",
		C: "cartridge",
		G: "gun",
		T: "tips",
		H: "hemasorb",
		HA: "hemasorbApply",
		P: "permatage",
	};
	const re = /\b(HA|[MCGTHP])\s*[-:=.]?\s*(\d{1,3})\b/g;
	for (const m of text.matchAll(re)) {
		const key = keyByLabel[m[1].toUpperCase()];
		if (key && q[key] === null) q[key] = Number(m[2]);
	}
	return q;
}

export async function extractShippingSheet(
	imageBuffer: Buffer,
): Promise<ShippingSheetExtraction> {
	const worker = await getWorker();
	const { data } = await worker.recognize(imageBuffer);
	const text = data.text ?? "";
	return {
		trackingNumber: findTrackingNumber(text),
		repName: findRepName(text),
		quantities: findQuantities(text),
		rawText: text,
	};
}
