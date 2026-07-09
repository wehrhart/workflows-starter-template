# Abyrx Tools

An internal **tools hub** for your work — a dashboard of small web tools, each
solving one workflow. Built on Cloudflare Workers, Workflows, Durable Objects,
and R2.

The first tool is **Kaiser Billing**: upload Kaiser bill sheet PDFs → the app
reads each PDF, resolves the surgery location, combines repeated products, and
appends the rows to a **running master sheet** — a copy of your Bill-Only
`.xlsm` template (macro + drop-downs preserved). Process bill sheets as they
trickle in; **Download master sheet** when you're ready to upload to Kaiser,
then **Clear** to start the next batch.

A second tool is **Price Quote Generator**: fill in a hospital + the prices you
want to quote → it produces a PDF that matches the ABYRX quote template exactly
(today's date, an expiration one month out, the hospital address you enter, the
cyan `Payment Terms` bar and the bordered item table). Only the products you
price are included, and pricing the single `OS-MON-1604` 4g unit also emits the
16g 4-pack at 4× that price. The PDF is built with jsPDF entirely in the
browser and saved as `[hospital name] quote.pdf`. See "Regenerating quote
assets" below for how the embedded brand images and catalog are sourced.

PDFs are read **locally** (no cloud AI), so the whole app runs on your machine
with `npm run dev` — no login, no API keys.

## Adding another tool

Tools live in `src/tools/`. To add one:

1. Write a component (e.g. `src/tools/MyTool.tsx`).
2. Register it in `src/tools/registry.tsx` with an `id`, `name`, `tagline`,
   `icon`, `status: "active"`, and `component`.

It then shows up automatically on the dashboard and sidebar, and is
deep-linkable at `#/<id>`. Add matching worker routes in `worker/index.ts` if
the tool needs a backend. Keep any pure logic in `worker/lib/` (unit-tested in
the Workers runtime) and anything that needs the DOM/canvas (e.g. jsPDF) under
`src/`, so the worker's no-DOM tsconfig stays happy.

### The standalone (hosted-link) page

`scripts/standalone/` builds a single self-contained `abyrx-tools.html` that runs
the same tool logic entirely client-side — no worker, no network — for hosting as
a tappable link. To surface a new tool there too:

1. Re-export its logic from `scripts/standalone/entry.ts` (it hangs a global the
   inline page script reads).
2. Add the tool to the `TOOLS` array in `scripts/standalone/page.html` and give
   it a `render…()` / `wire()` block.
3. Rebuild and verify in a real browser:

   ```bash
   node_modules/.bin/esbuild scripts/standalone/entry.ts --bundle \
     --format=iife --platform=browser --target=es2020 --minify \
     --outfile=scripts/standalone/bundle.js
   node scripts/standalone/build.mjs            # inlines bundle.js into abyrx-tools.html
   node scripts/standalone/verify-quote.mjs     # drives the Price Quote tool in Chromium
   node scripts/standalone/verify-page.mjs      # drives Kaiser Billing in Chromium
   ```

   `bundle.js` and `abyrx-tools.html` are generated (gitignored); rebuild them
   from source whenever a tool changes.

## How it works

```
PDF bill sheet(s)
   │  unpdf (a Workers build of pdf.js) reads each PDF; a label-anchored parser
   │  pulls the fields — deterministic, offline, no cloud AI
   ▼
resolve & map
   │  • Surgery Location (col A): zip + shipping address → Location ID
   │  • combine duplicate product numbers: Quantity = count, Unit Price = summed total
   │  • Case ID present  → row on "Bill Only Spreadsheet Upload"
   │  • Case ID missing  → row on a "Missing Case ID" tab (rep / date / surgeon)
   ▼
add to master sheet
   │  append the rows to the running ledger (a Durable Object) shared across
   │  every batch
   ▼
Download master sheet  →  surgical XML injection into your real .xlsm — VBA
macro, Excel tables, and the column A / L drop-down validations left
byte-for-byte intact.  Clear resets the master for the next batch.
```

### Column mapping (Bill Only Spreadsheet Upload)

| Column | Field | Source |
| --- | --- | --- |
| A | Surgery Location | Location ID resolved from shipping zip + address |
| B | Case ID | Case Details on the bill sheet |
| C | Surgery Date | Date of Surgery (MM/DD/YYYY) |
| D | Physician Name | Surgeon's Name |
| G | Rep Name | Distributor/Rep |
| I | Supplier Item ID | Product Number |
| J | Item Description | Description |
| K | Quantity | count of matching product-number lines |
| L | UOM | defaults to `EA` |
| M | Unit Price | **summed** total of the combined lines |
| R | Lot # | Lot number(s) |

### Surgery Location resolution

A shipping zip often maps to several Location IDs (OR, CVOR, CCL, ASC …). The
resolver is fully deterministic — there is **no** review step:

1. **Override table** (`worker/lib/locations.ts` → `LOCATION_OVERRIDES`) wins
   outright. Seeded with `97015 → 10702` (Kaiser Sunnyside). Add your own locks
   here.
2. **Address match** — narrow the zip's candidates to those whose street address
   matches the bill sheet's shipping address.
3. **Prefer the OR** — pick the general operating room over specialty rooms.
4. **Lowest ID** breaks any remaining tie (e.g. West LA defaults to East Tower
   `08721`).

Only a zip that isn't a known Kaiser facility leaves column A blank.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Open the URL, click **Kaiser Billing**, drop in bill sheet PDFs, and download the
filled spreadsheet. No login, no cloud account — everything (PDF reading, the
workflow, storage) runs locally via Miniflare.

`npm test` runs the unit tests (PDF parsing, transform logic, `.xlsm` injection)
in the Workers runtime.

## Deploy (optional — for an always-on hosted URL)

```bash
wrangler r2 bucket create abyrx-bill-sheets   # one time (stores uploads + output)
npm run deploy
```

The blank master template is embedded in the app, so there's nothing else to
upload. The first deploy provisions the Workflow and Durable Object.
`npm run build`/`check` run `wrangler types` first, so the generated
`worker-configuration.d.ts` (gitignored) is created automatically.

## Updating the reference data

`worker/data/locations.ts` is generated from the master template's *Locations*
tab (facility names, street addresses, zips). Drop the master `.xlsm` at
`scripts/bill-only-template.xlsm` (gitignored) and run — requires
`pip install openpyxl`:

```bash
python3 scripts/gen-locations.py            # or pass a path: gen-locations.py <template.xlsm>
python3 scripts/gen-template.py             # re-embed the template (worker/assets/template.ts)
```

The upload sheet is `sheet2.xml` inside the workbook and data is written from
row 3; if the template's sheet order changes, update `DATA_SHEET` in
`worker/lib/xlsx-inject.ts`. The bill-sheet parser lives in
`worker/lib/extract.ts` — tune the label anchors there if a sheet's layout
differs.

## Regenerating quote assets

The **Price Quote Generator** is driven entirely by `worker/lib/quote.ts`: the
`QUOTE_CATALOG` there is the single source of truth for the codes, quantities,
descriptions and default list prices, copied from the quote template
(`Quote_temp.docx`). Edit that array to change the products or prices.

The two embedded brand images (header wordmark + footer X-mark) come from the
template's `word/media/*.jpeg`, re-encoded to RGB JPEG for jsPDF. Regenerate them
from a template `.docx` with — requires `pip install pillow`:

```bash
python3 scripts/gen-quote-logo.py path/to/Quote_temp.docx
```

The PDF layout (page size, margins, column widths, the cyan `#00B0F0` bars,
fonts) lives in `src/tools/quote-pdf.ts`. jsPDF's built-in Helvetica can't draw
the template's Greek `β`, so `βeta` is normalized to `Beta`; everything else is
verbatim.
