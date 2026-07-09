import { describe, it, expect } from "vitest";
import {
	buildQuote,
	buildToLines,
	formatMoney,
	formatQuoteDate,
	oneMonthAfter,
	parsePrice,
	QUOTE_INPUTS,
	type QuoteHeader,
} from "../worker/lib/quote";

const HEADER: QuoteHeader = {
	hospitalName: "Jackson Health System",
	streetAddress: "1611 NW 12th Avenue",
	city: "Miami",
	state: "FL",
	zip: "33136",
};

describe("formatMoney", () => {
	it("adds thousands separators and two decimals", () => {
		expect(formatMoney(1748)).toBe("$1,748.00");
		expect(formatMoney(833)).toBe("$833.00");
		expect(formatMoney(3332)).toBe("$3,332.00");
		expect(formatMoney(5233)).toBe("$5,233.00");
		expect(formatMoney(0)).toBe("$0.00");
	});
});

describe("parsePrice", () => {
	it("accepts plain, comma'd and $-prefixed numbers; rejects blanks/garbage", () => {
		expect(parsePrice("1748")).toBe(1748);
		expect(parsePrice("1,748.00")).toBe(1748);
		expect(parsePrice("$2,812")).toBe(2812);
		expect(parsePrice("")).toBeNull();
		expect(parsePrice("   ")).toBeNull();
		expect(parsePrice("abc")).toBeNull();
		expect(parsePrice(null)).toBeNull();
	});
});

describe("dates", () => {
	it("formats as 'Month D, YYYY'", () => {
		expect(formatQuoteDate(new Date(2026, 6, 9))).toBe("July 9, 2026");
	});
	it("one month after, with end-of-month clamping", () => {
		expect(formatQuoteDate(oneMonthAfter(new Date(2026, 6, 9)))).toBe("August 9, 2026");
		// Jan 31 → Feb has no 31st, clamp to Feb 28 (2026 is not a leap year).
		expect(formatQuoteDate(oneMonthAfter(new Date(2026, 0, 31)))).toBe("February 28, 2026");
		// Dec rolls the year.
		expect(formatQuoteDate(oneMonthAfter(new Date(2026, 11, 15)))).toBe("January 15, 2027");
	});
});

describe("buildToLines", () => {
	it("builds hospital / street / 'City, ST ZIP', dropping blanks", () => {
		expect(buildToLines(HEADER)).toEqual([
			"Jackson Health System",
			"1611 NW 12th Avenue",
			"Miami, FL 33136",
		]);
		expect(buildToLines({ ...HEADER, streetAddress: "", zip: "" })).toEqual([
			"Jackson Health System",
			"Miami, FL",
		]);
	});
});

describe("buildQuote", () => {
	const today = new Date(2026, 6, 9); // July 9, 2026

	it("only includes products with a price, in template order", () => {
		const quote = buildQuote(
			HEADER,
			{ "OS-MON-1001": 1748, "OS-401": 224 },
			today,
		);
		expect(quote.lines.map((l) => l.code)).toEqual(["OS-MON-1001", "OS-401"]);
		expect(quote.lines.map((l) => l.priceText)).toEqual(["$1,748.00", "$224.00"]);
		expect(quote.dateText).toBe("July 9, 2026");
		expect(quote.expirationText).toBe("August 9, 2026");
	});

	it("names the file '[hospital] quote.pdf'", () => {
		expect(buildQuote(HEADER, { "OS-401": 224 }, today).fileName).toBe(
			"Jackson Health System quote.pdf",
		);
	});

	it("OS-MON-1604 single unit also emits the 16g 4-pack at 4x, in order", () => {
		const quote = buildQuote(HEADER, { "OS-MON-1604": 833 }, today);
		// The multi-pack row (code OS-MON-1604, '1 pack') comes first in template
		// order, then the single 4g unit (its Item # carries the asterisk note).
		expect(quote.lines.map((l) => ({ code: l.code, qty: l.qty, price: l.price }))).toEqual([
			{ code: "OS-MON-1604", qty: "1 pack", price: 3332 },
			{
				code: "OS-MON-1604*(MONTAGE 2cc each only available on bill only basis)",
				qty: "1 each",
				price: 833,
			},
		]);
		expect(quote.lines[0].derived).toBe(true);
		expect(quote.lines[1].derived).toBe(false);
	});

	it("does not emit the 4-pack when 1604 is left blank", () => {
		const quote = buildQuote(HEADER, { "OS-MON-1001": 1748 }, today);
		expect(quote.lines.some((l) => l.qty === "1 pack")).toBe(false);
	});

	it("exposes exactly 11 fillable inputs (12 template rows minus the derived pack)", () => {
		expect(QUOTE_INPUTS).toHaveLength(11);
		expect(QUOTE_INPUTS.some((p) => p.id === "OS-MON-1604-4PACK")).toBe(false);
	});

	it("returns no lines when nothing is priced", () => {
		expect(buildQuote(HEADER, {}, today).lines).toHaveLength(0);
	});
});
