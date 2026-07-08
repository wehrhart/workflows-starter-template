/**
 * The blank Bill-Only .xlsm template is stored as an object in the R2 bucket
 * (not embedded in the bundle, so it can be swapped without a redeploy).
 *
 * Upload it once after creating the bucket:
 *   wrangler r2 object put abyrx-bill-sheets/_template/bill-only-template.xlsm \
 *     --file=path/to/Bill_Only_File_Upload_Template.xlsm
 */
export const TEMPLATE_KEY = "_template/bill-only-template.xlsm";

let cached: Uint8Array | null = null;

/** Fetch the blank template from R2 (memoized for the isolate's lifetime). */
export async function getTemplateBytes(env: Env): Promise<Uint8Array> {
	if (cached) return cached;
	const obj = await env.BILL_SHEETS.get(TEMPLATE_KEY);
	if (!obj) {
		throw new Error(
			`Template not found in R2 at "${TEMPLATE_KEY}". Upload it with: ` +
				`wrangler r2 object put abyrx-bill-sheets/${TEMPLATE_KEY} --file=<template.xlsm>`,
		);
	}
	cached = new Uint8Array(await obj.arrayBuffer());
	return cached;
}
