#!/usr/bin/env python3
"""Generate a minimal but valid bill-sheet PDF to exercise the browser bundle."""
import sys, zlib

# Lines of text drawn onto the page. Mirrors the fields the parser anchors on,
# including a "Case Information" label and one product row.
LINES = [
    "Surgery Information",
    "Date of Surgery 7/6/2026",
    "Surgeon's Name James Jackman",
    "Procedure Tibial Plateau ORIF",
    "Where Used",
    "Case Information E-settlements case #3859691",
    "Hospital Information Name Kaiser Sunnyside Medical Center",
    "Vendor Name Abyrx, Inc.",
    "Contact",
    "Shipping Address 10180 SE Sunnyside Road, Clackamas, OR 97015",
    "Billing Address 10180 SE Sunnyside Road, Clackamas, OR 97015",
    "Phone (503) 652-2880",
    "Rep Name Christopher Turner",
    "Product Usage Information",
    "Product Number Description Lot Number UID Units Used Price Per Unit Total Price",
    "OS-MON-1001 MONTAGE 5cc 20387 203870154 1.00 1,448.00 1,448.00",
    "Total 1,448.00",
]

def esc(s: str) -> str:
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

content = ["BT", "/F1 10 Tf", "50 740 Td", "12 TL"]
for i, line in enumerate(LINES):
    content.append(f"({esc(line)}) Tj")
    content.append("0 -18 Td")
content.append("ET")
stream = "\n".join(content).encode("latin-1")

objs = []
objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>")
objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

out = bytearray(b"%PDF-1.4\n")
offsets = []
for i, body in enumerate(objs, start=1):
    offsets.append(len(out))
    out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"

xref_pos = len(out)
out += f"xref\n0 {len(objs)+1}\n".encode()
out += b"0000000000 65535 f \n"
for off in offsets:
    out += f"{off:010d} 00000 n \n".encode()
out += b"trailer\n"
out += f"<< /Size {len(objs)+1} /Root 1 0 R >>\n".encode()
out += b"startxref\n" + str(xref_pos).encode() + b"\n%%EOF\n"

path = sys.argv[1] if len(sys.argv) > 1 else "test-bill-sheet.pdf"
with open(path, "wb") as f:
    f.write(out)
print(f"wrote {path} ({len(out)} bytes)")
