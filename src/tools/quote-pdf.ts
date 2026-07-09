/**
 * Render a resolved {@link Quote} to a PDF that mirrors the ABYRX quote template
 * (Quote_temp.docx): ABYRX wordmark header, the Date / Expiration / To block, the
 * cyan "Payment Terms" bar, the bordered item table, and the footer mark.
 *
 * jsPDF runs the same in the Worker-less browser tool and in the standalone
 * hosted page, so this is the only rendering path — nothing leaves the device.
 *
 * Lives under src/ (not worker/) because jsPDF needs the DOM/canvas; the worker
 * tsconfig has no DOM lib. The pure catalog/transform logic stays in
 * worker/lib/quote.ts so it can be unit-tested in the Workers runtime.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Quote } from "../../worker/lib/quote";
import { QUOTE_LOGO_JPEG_BASE64, QUOTE_MARK_JPEG_BASE64 } from "../../worker/assets/quote-logo";

// US Letter in points (72pt/inch). Margins mirror the template: 1" sides,
// 1.5" top/bottom, header 0.5" from the top edge.
const PAGE_W = 612;
const LEFT = 72;
const RIGHT = 72;
const CONTENT_W = PAGE_W - LEFT - RIGHT; // 468
const CYAN: [number, number, number] = [0, 176, 240]; // #00B0F0

// Header wordmark: template renders it 2.62" × 1.01", left-aligned in the header.
const LOGO_W = 188.6;
const LOGO_H = LOGO_W * (291 / 760); // preserve native aspect
const LOGO_Y = 36;

// Footer X-mark, centered near the bottom edge.
const MARK_W = 44;
const MARK_H = MARK_W * (128 / 150);

/**
 * jsPDF's built-in Helvetica is WinAnsi-encoded and can't draw the Greek β the
 * template uses to spell "βeta-Tricalcium". Map it to the word it stands for so
 * the text stays readable instead of rendering an empty box; normalize smart
 * punctuation to ASCII for the same reason.
 */
function sanitize(text: string): string {
	return text
		.replace(/β/g, "B") // β → B  ("βeta" → "Beta")
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/[–—]/g, "-");
}

function drawHeaderFooter(doc: jsPDF) {
	// Header wordmark, left-aligned at the left margin.
	doc.addImage(
		`data:image/jpeg;base64,${QUOTE_LOGO_JPEG_BASE64}`,
		"JPEG",
		LEFT,
		LOGO_Y,
		LOGO_W,
		LOGO_H,
	);

	// Footer: centered X-mark over "ABYRX, INC" / "ABYRX.COM".
	const cx = PAGE_W / 2;
	doc.addImage(
		`data:image/jpeg;base64,${QUOTE_MARK_JPEG_BASE64}`,
		"JPEG",
		cx - MARK_W / 2,
		700,
		MARK_W,
		MARK_H,
	);
	doc.setFont("helvetica", "normal");
	doc.setTextColor(64, 64, 64);
	doc.setFontSize(8);
	doc.text("ABYRX, INC", cx, 752, { align: "center" });
	doc.setFontSize(7);
	doc.text("ABYRX.COM", cx, 761, { align: "center" });
	doc.setTextColor(0, 0, 0);
}

/** Lay out the quote into a jsPDF document. */
function renderQuoteDoc(quote: Quote): jsPDF {
	const doc = new jsPDF({ unit: "pt", format: "letter" });

	// ---- Meta block (borderless, matching the template's first table) ----
	// The header wordmark + footer are painted by autoTable's didDrawPage hook
	// (which fires for page 1 too), so every page — including any overflow page —
	// gets the brand chrome.
	const RIGHT_COL_X = LEFT + 288; // template col0 is 4" wide; value column follows
	doc.setFont("helvetica", "normal");
	doc.setFontSize(11);
	doc.setTextColor(0, 0, 0);

	let y = 128;
	doc.text(`Date: ${quote.dateText}`, RIGHT_COL_X, y);
	y += 15;
	doc.text(`Expiration Date: ${quote.expirationText}`, RIGHT_COL_X, y);

	y += 20;
	doc.text("To", LEFT, y);
	let addrY = y;
	for (const line of quote.toLines) {
		doc.text(sanitize(line), RIGHT_COL_X, addrY);
		addrY += 15;
	}

	// Cyan "Payment Terms" bar spanning the content width.
	const barY = Math.max(y, addrY - 15) + 12;
	const barH = 18;
	doc.setFillColor(...CYAN);
	doc.rect(LEFT, barY, CONTENT_W, barH, "F");
	doc.setFontSize(11);
	doc.text("Payment Terms", LEFT + 6, barY + 13);

	// "30 Days Net", centered, 9pt (template uses sz 18 = 9pt here).
	const netY = barY + barH;
	doc.setFontSize(9);
	doc.text("30 Days Net", PAGE_W / 2, netY + 12, { align: "center" });

	// ---- Item table (bordered, matching the template's second table) ----
	// Column widths are the template grid ratios (881:1635:4200:2885) scaled to
	// the 468pt content width.
	autoTable(doc, {
		startY: netY + 26,
		margin: { top: 108, left: LEFT, right: RIGHT, bottom: 92 },
		theme: "grid",
		tableLineColor: [0, 0, 0],
		tableLineWidth: 0.5,
		styles: {
			font: "helvetica",
			fontSize: 8,
			textColor: [0, 0, 0],
			halign: "center",
			valign: "middle",
			lineColor: [0, 0, 0],
			lineWidth: 0.5,
			cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
			overflow: "linebreak",
		},
		headStyles: {
			fillColor: CYAN,
			textColor: [0, 0, 0],
			fontStyle: "normal",
			fontSize: 11,
			halign: "left",
		},
		columnStyles: {
			0: { cellWidth: 42.9 },
			1: { cellWidth: 79.7 },
			2: { cellWidth: 204.7, fontStyle: "bold" },
			3: { cellWidth: 140.7, fontSize: 9 },
		},
		head: [["Qty", "Item #", "Description", "Price"]],
		body: quote.lines.map((l) => [
			sanitize(l.qty),
			sanitize(l.code),
			sanitize(l.description),
			l.priceText,
		]),
		didDrawPage: () => drawHeaderFooter(doc),
	});

	return doc;
}

/** Build the quote PDF and return its bytes. */
export function buildQuotePdf(quote: Quote): Uint8Array {
	return new Uint8Array(renderQuoteDoc(quote).output("arraybuffer"));
}

/** Convenience: the quote PDF as a Blob ready for a download link. */
export function buildQuotePdfBlob(quote: Quote): Blob {
	return renderQuoteDoc(quote).output("blob");
}
