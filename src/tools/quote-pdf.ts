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
// 1.5" top/bottom, header 0.5" from the top edge. All geometry below is taken
// from the template's OOXML (twips ÷ 20 = points) so the output is identical.
const PAGE_W = 612;
const LEFT = 72;
const RIGHT = 72;
const CONTENT_W = PAGE_W - LEFT - RIGHT; // 468
const CYAN: [number, number, number] = [0, 176, 240]; // #00B0F0
const GRAY: [number, number, number] = [64, 64, 64]; // #404040 (meta text)

// Meta table grid (5760 | 3481 | 250 twips): the "To" label column ends at
// 288pt, the right-aligned value column at 288 + 174 = 462pt from the margin.
const META_LABEL_RIGHT = LEFT + 288; // 360 — "To" right-aligns here
const META_VALUE_RIGHT = LEFT + 462; // 534 — dates/address right-align here

// Item table: grid cols 881/1635/4200/2885 twips = 44.05/81.75/210/144.25pt,
// 480.05pt total, centered on the page (tblpPr tblpXSpec="center"), floated
// 121 twips ≈ 6pt below the payment-terms block.
const ITEM_COLS = [44.05, 81.75, 210, 144.25];
const ITEM_TABLE_W = ITEM_COLS[0] + ITEM_COLS[1] + ITEM_COLS[2] + ITEM_COLS[3];
const ITEM_TABLE_X = (PAGE_W - ITEM_TABLE_W) / 2;

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

	// ---- Meta block (matching the template's first table exactly) ----
	// The header wordmark + footer are painted by autoTable's didDrawPage hook
	// (which fires for page 1 too), so every page — including any overflow page —
	// gets the brand chrome.
	//
	// Date / Expiration: "DateandNumber" style — right-aligned, 8pt, #404040,
	// 0.2pt letter spacing. Body starts at the 1.5" top margin (108pt).
	doc.setFont("helvetica", "normal");
	doc.setFontSize(8);
	doc.setTextColor(...GRAY);
	doc.text(`Date: ${quote.dateText}`, META_VALUE_RIGHT, 118, {
		align: "right",
		charSpace: 0.2,
	});
	doc.text(`Expiration Date: ${quote.expirationText}`, META_VALUE_RIGHT, 129, {
		align: "right",
		charSpace: 0.2,
	});

	// "To": Heading2 style — bold 8pt #404040, right-aligned in the label column.
	const blockTop = 142;
	doc.setFont("helvetica", "bold");
	doc.text("To", META_LABEL_RIGHT, blockTop, { align: "right" });

	// Address: "Right-aligned text" style — 8pt #404040, 12pt line pitch, with
	// the template's blank line between the hospital name and the street.
	doc.setFont("helvetica", "normal");
	let addrY = blockTop;
	quote.toLines.forEach((line, i) => {
		doc.text(sanitize(line), META_VALUE_RIGHT, addrY, { align: "right" });
		addrY += i === 0 ? 24 : 12; // blank template line after the name
	});
	doc.setTextColor(0, 0, 0);

	// The template pads the address cell with three empty 12pt lines before the
	// payment-terms rows, which span the content width (row width 9350 twips).
	const barY = Math.max(addrY - 12, blockTop + 36) + 39;
	const barW = CONTENT_W - 0.5; // row width 9350 twips = 467.5pt
	const barX = LEFT;

	// Cyan "Payment Terms" bar: "ColumnHeadings" style — bold 8pt WHITE, centered.
	const barH = 14.4;
	doc.setFillColor(...CYAN);
	doc.setDrawColor(...CYAN);
	doc.setLineWidth(0.5);
	doc.rect(barX, barY, barW, barH, "FD");
	doc.setFont("helvetica", "bold");
	doc.setFontSize(8);
	doc.setTextColor(255, 255, 255);
	doc.text("Payment Terms", barX + barW / 2, barY + barH / 2 + 2.9, { align: "center" });

	// "30 Days Net" box: white cell outlined in cyan (the template's tblPrEx puts
	// 0.5pt #00B0F0 borders around both payment-terms rows). 9pt black, centered.
	const boxY = barY + barH;
	const boxH = 17;
	doc.setFillColor(255, 255, 255);
	doc.rect(barX, boxY, barW, boxH, "FD");
	doc.setFont("helvetica", "normal");
	doc.setFontSize(9);
	doc.setTextColor(0, 0, 0);
	doc.text("30 Days Net", barX + barW / 2, boxY + boxH / 2 + 3.2, { align: "center" });
	const netY = boxY + boxH;

	// ---- Item table (bordered, matching the template's second table) ----
	// Grid columns 881/1635/4200/2885 twips, 480pt total, centered on the page,
	// floated 6pt (121 twips) below the payment-terms block. Header row is the
	// "ColumnHeadings" style: bold 8pt white, centered, on #00B0F0. Cell margins
	// are the template's 43/115 twips (2.15pt / 5.75pt).
	autoTable(doc, {
		startY: netY + 6,
		margin: { top: 108, left: ITEM_TABLE_X, right: ITEM_TABLE_X, bottom: 92 },
		tableWidth: ITEM_TABLE_W,
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
			cellPadding: { top: 2.15, right: 5.75, bottom: 2.15, left: 5.75 },
			overflow: "linebreak",
		},
		headStyles: {
			fillColor: CYAN,
			textColor: [255, 255, 255],
			fontStyle: "bold",
			fontSize: 8,
			halign: "center",
		},
		columnStyles: {
			0: { cellWidth: ITEM_COLS[0] },
			1: { cellWidth: ITEM_COLS[1] },
			2: { cellWidth: ITEM_COLS[2], fontStyle: "bold" },
			3: { cellWidth: ITEM_COLS[3], fontSize: 9 },
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
