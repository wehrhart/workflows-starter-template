# Abyrx Tools

An internal **tools hub** for your work — a dashboard of small web tools, each
solving one workflow. Built on Cloudflare Workers, Workflows, Durable Objects,
Workers AI, and R2.

The first tool is **Kaiser Billing**: upload one or more Kaiser bill sheet PDFs
→ the app reads each PDF, resolves the surgery location, combines repeated
products, and writes the rows straight into a copy of your master Bill-Only
`.xlsm` template (macro + drop-downs preserved) so you can mass upload as-is.

## Adding another tool

Tools live in `src/tools/`. To add one:

1. Write a component (e.g. `src/tools/MyTool.tsx`).
2. Register it in `src/tools/registry.tsx` with an `id`, `name`, `tagline`,
   `icon`, `status: "active"`, and `component`.

It then shows up automatically on the dashboard and sidebar, and is
deep-linkable at `#/<id>`. Add matching worker routes in `worker/index.ts` if
the tool needs a backend.

## How it works

```
PDF bill sheet(s)
   │  Workers AI (toMarkdown + Llama 3.3) reads each PDF into structured fields
   ▼
resolve & map
   │  • Surgery Location (col A): zip + shipping address → Location ID
   │  • combine duplicate product numbers: Quantity = count, Unit Price = summed total
   │  • Case ID present  → row on "Bill Only Spreadsheet Upload"
   │  • Case ID missing  → row on a "Missing Case ID" tab (rep / date / surgeon)
   ▼
build spreadsheet
   │  surgical XML injection into your real .xlsm — VBA macro, Excel tables,
   │  and the column A / L drop-down validations are left byte-for-byte intact
   ▼
download the filled .xlsm
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

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm test` runs the unit tests (transform logic + `.xlsm` injection) in the
Workers runtime.

## Deploy

```bash
wrangler r2 bucket create abyrx-bill-sheets                 # one time
wrangler r2 object put abyrx-bill-sheets/_template/bill-only-template.xlsm \
  --file=path/to/Bill_Only_File_Upload_Template.xlsm       # one time
npm run deploy
```

The blank master template lives in R2 (key `_template/bill-only-template.xlsm`),
so you can swap it later without redeploying. Workers AI is enabled by the `ai`
binding — no extra setup. The first deploy provisions the Workflow and Durable
Object. `npm run build`/`check` run `wrangler types` first, so the generated
`worker-configuration.d.ts` (gitignored) is created automatically.

## Updating the reference data

`worker/data/locations.ts` is generated from the master template's *Locations*
tab (facility names, street addresses, zips). Drop the master `.xlsm` at
`scripts/bill-only-template.xlsm` (gitignored) and run — requires
`pip install openpyxl`:

```bash
python3 scripts/gen-locations.py            # or pass a path: gen-locations.py <template.xlsm>
```

The upload sheet is `sheet2.xml` inside the workbook and data is written from
row 3; if the template's sheet order changes, update `DATA_SHEET` in
`worker/lib/xlsx-inject.ts`.
