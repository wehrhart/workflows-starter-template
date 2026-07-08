import { TEMPLATE_XLSM_BASE64 } from "../assets/template";

let cached: Uint8Array | null = null;

/**
 * Decode the embedded blank Bill-Only template into bytes (memoized).
 * Embedded (not fetched from R2) so the app is self-contained and runs locally
 * with no extra setup.
 */
export function getTemplateBytes(): Uint8Array {
	if (cached) return cached;
	const bin = atob(TEMPLATE_XLSM_BASE64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	cached = bytes;
	return bytes;
}
