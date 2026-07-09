/**
 * Save a blob URL as a named file — including from inside the hosted-artifact
 * iframe, whose sandbox blocks page-initiated downloads.
 *
 * Top-level pages get a plain <a download> click. Embedded pages route through
 * a "trampoline": a tiny HTML page opened via window.open (popups are allowed
 * to escape the sandbox even where downloads are not) that auto-clicks its own
 * <a download> — outside the sandbox the download proceeds, with the right
 * filename — then closes itself. If the popup is blocked we still try the
 * direct click, and callers keep a visible link for manual/right-click saving.
 */

function escapeAttr(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/"/g, "&quot;");
}

function directClick(url: string, fileName: string): void {
	const a = document.createElement("a");
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	a.remove();
}

/** Must be called from a user gesture (click handler) so the popup opens. */
export function saveBlobUrl(url: string, fileName: string): void {
	if (window.self === window.top) {
		directClick(url, fileName);
		return;
	}

	const name = escapeAttr(fileName);
	const html =
		'<!doctype html><meta charset="utf-8"><title>' + name + "</title>" +
		'<body style="font-family:system-ui,sans-serif;padding:28px;color:#333">' +
		"<p>Downloading <b>" + name + "</b>…</p>" +
		'<p>If it didn’t start, <a id="dl" href="' + url + '" download="' + name + '">tap here to download it</a>.' +
		" This tab closes itself.</p>" +
		"<script>document.getElementById('dl').click();" +
		"setTimeout(function(){window.close()},3000);</script>";
	const trampolineUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
	const w = window.open(trampolineUrl, "_blank");
	if (!w) directClick(url, fileName); // popup blocked — try the direct route
	setTimeout(() => URL.revokeObjectURL(trampolineUrl), 60_000);
}
