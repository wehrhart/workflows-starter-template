#!/usr/bin/env python3
"""Regenerate worker/assets/template.ts from scripts/bill-only-template.xlsm.

The blank Bill-Only template is embedded (base64) so the app is self-contained
and runs locally with no R2 setup. Drop a newer master template at
scripts/bill-only-template.xlsm (gitignored) and re-run this to update it.
"""
import base64, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
b = (root / "scripts/bill-only-template.xlsm").read_bytes()
s = base64.b64encode(b).decode()
out = ('// AUTO-GENERATED. Base64 of the blank Kaiser Bill-Only .xlsm upload template.\n'
       '// Regenerate with scripts/gen-template.py after replacing scripts/bill-only-template.xlsm.\n'
       '// The worker decodes this, injects rows into "Bill Only Spreadsheet Upload", and returns it.\n\n'
       'export const TEMPLATE_XLSM_BASE64 =\n  "' + s + '";\n')
(root / "worker/assets/template.ts").write_text(out)
print("wrote worker/assets/template.ts")
