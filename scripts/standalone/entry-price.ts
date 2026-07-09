/**
 * Minimal browser entry that exposes ONLY the Price Information engine as
 * window.AbyrxPrice. Used to inject Price Information into the existing hosted
 * Abyrx Tools artifact without rebuilding (or disturbing) the Kaiser Billing
 * and Price Quote Generator bundles already there.
 */
import { lookupPrice, formatReport, normalizeCode } from "../../worker/lib/price-lookup";
import { PRICE_DATA } from "../../worker/lib/price-data";

export const AbyrxPrice = {
	lookup: (code: string) => lookupPrice(code),
	report: formatReport,
	normalizeCode,
	generatedAt: PRICE_DATA.generatedAt,
	facilityCount: PRICE_DATA.facilityCount,
};
(globalThis as unknown as { AbyrxPrice: typeof AbyrxPrice }).AbyrxPrice = AbyrxPrice;
