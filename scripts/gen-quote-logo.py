#!/usr/bin/env python3
"""Regenerate worker/assets/quote-logo.ts from the ABYRX quote template.

The Price Quote PDF embeds two brand images pulled from Quote_temp.docx:
the header wordmark (word/media/image1.jpeg) and the footer X-mark
(word/media/image2.jpeg). Both are CMYK in the .docx; jsPDF needs RGB, so we
re-encode them to RGB JPEG and base64-embed them.

Usage:
    pip install pillow
    python3 scripts/gen-quote-logo.py path/to/Quote_temp.docx
"""
import base64
import sys
import zipfile
from io import BytesIO

from PIL import Image


def to_jpeg_b64(data: bytes, target_w: int, quality: int = 90):
    im = Image.open(BytesIO(data)).convert("RGB")
    w, h = im.size
    nh = int(h * target_w / w)
    im = im.resize((target_w, nh), Image.LANCZOS)
    buf = BytesIO()
    im.save(buf, "JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode(), target_w, nh


def main() -> None:
    docx = sys.argv[1] if len(sys.argv) > 1 else "scripts/Quote_temp.docx"
    with zipfile.ZipFile(docx) as z:
        header = z.read("word/media/image1.jpeg")
        mark = z.read("word/media/image2.jpeg")

    hdr_b64, hw, hh = to_jpeg_b64(header, 760)
    mrk_b64, mw, mh = to_jpeg_b64(mark, 150)

    out = (
        "// Embedded ABYRX brand images for the Price Quote PDF (RGB JPEG, base64).\n"
        "// Generated from the quote template's header wordmark (image1) and footer\n"
        "// X-mark (image2). Regenerate with scripts/gen-quote-logo.py if the brand changes.\n\n"
        f"/** ABYRX wordmark shown in the quote header. Native px: {hw}x{hh}. */\n"
        f'export const QUOTE_LOGO_JPEG_BASE64 =\n\t"{hdr_b64}";\n\n'
        f"/** ABYRX X-mark shown in the quote footer. Native px: {mw}x{mh}. */\n"
        f'export const QUOTE_MARK_JPEG_BASE64 =\n\t"{mrk_b64}";\n\n'
        f"export const QUOTE_LOGO_ASPECT = {hw / hh:.5f}; // width/height\n"
        f"export const QUOTE_MARK_ASPECT = {mw / mh:.5f};\n"
    )
    with open("worker/assets/quote-logo.ts", "w") as f:
        f.write(out)
    print("wrote worker/assets/quote-logo.ts")


if __name__ == "__main__":
    main()
