# Demo Units — selector calibration checklist

Goal: confirm every entry in `SEL` (in `demoUnitsRunner.ts`) against the real
Kairuku site, so Demo Units can run for real. This file is the single source
of truth for what is confirmed vs guessed. Update it as selectors get locked.

Works for either calibration mode:
- **Remote**: Will captures each page (screenshot + the Demo Units tab's
  "Capture current Kairuku page" box) and pastes them to a Claude session.
- **Local**: a Claude Code session on Will's machine inspects the standing
  Kairuku window directly (via the sidecar / `requireKairukuSession()`).

## Safety rules (non-negotiable)

1. **NEVER click "Request Overage"** — capture it and Dashboard out.
2. **NEVER click "Save"** during calibration. Entries are only created on
   Save; Verify and Continue to Add are assumed non-mutating (the dry-run
   design relies on this). If any screen suggests something was committed
   before Save, STOP and tell Will.
3. Dry-run only until every selector below is CONFIRMED.
4. No credentials, MFA codes, cookies, or tokens in logs, the repo, or chat.

## Selector status

### CONFIRMED (v14, live authenticated inspection — do not re-guess)

| SEL key              | Value                              | Notes |
|----------------------|------------------------------------|-------|
| `demoPagePath`       | `chargesheets.aspx`                | hosts the Demo Check widget, via UID Tracking nav |
| `distributorSelect`  | `#DistributorID_DemoCheck`         | ~24 demo-eligible distributors only |
| `salesRepSelect`     | `#SalesRepID_DemoCheck`            | repopulates via AJAX after distributor pick |
| `productSelect`      | `#Item_DemoCheck`                  | |
| `qtyInput`           | `#DemoUnitsReequested_DemoCheck`   | Kairuku really spells it "Reequested" |
| `btnVerifyId`        | `#Button_DemoCheck_Submit`         | |

### UNCONFIRMED — the calibration targets

| SEL key          | Current guess                  | Needed evidence |
|------------------|--------------------------------|-----------------|
| `btnOverage`     | text "Request Overage"         | post-Verify page, overage case |
| `btnContinue`    | text "Continue to Add"         | post-Verify page, normal case |
| `btnSave`        | text "Save"                    | final add page |
| `labelNotes`     | label matching `/note/i`       | final add page — need real control ID |
| `labelUnits`     | label matching `/^units/i`     | final add page — need real control ID |
| `labelTracking`  | label matching `/tracking/i`   | final add page — need real control ID |
| `labelFulfilled` | label matching `/fulfilled/i`  | final add page — need real checkbox ID (current fallback is "first checkbox on the page": too loose) |
| `productMontage` | `/^montage$/i`                 | re-verify exact option text on a fresh capture (must NOT match "MONTAGE Fast Set") |
| `productFlowable`| `/montage\s*flowable/i`        | same |

Also confirm on the post-Verify page: does Verify navigate, or update the
same page in place? Does the overage case replace "Continue to Add" or show
both buttons?

## Capture procedure (per page)

For each screen in the sequence below, collect BOTH:
- the **capture box**: Demo Units tab → blue "Capture current Kairuku page"
  button → copy the whole box (it lists every input/select/button with its
  real WebForms ID — this is what selectors are written from), and
- a **screenshot** of the Kairuku window (shows layout, which text is a
  button vs a heading, anything the fingerprint can't).

Sequence (in the standing Kairuku window, logged in):
1. `chargesheets.aspx` fresh — the Demo Check widget, nothing selected.
2. Distributor picked → rep dropdown repopulated → rep + product `MONTAGE`
   picked, quantity `1` typed. Capture BEFORE clicking Verify.
3. Click **Verify Demo Unit Request** → capture whatever appears
   (normal case and — if one comes up — the overage case; don't hunt for an
   overage on a real rep's account without Will's say-so).
4. If "Continue to Add" appeared: click it → capture the **final add page**
   (Notes / Units / Tracking / Fulfilled / Save). This page is the single
   most valuable capture — it retires four guessed selectors at once.
5. Click **Dashboard** to back out. Nothing was saved.

## Definition of done

- [ ] Every UNCONFIRMED row above moved to CONFIRMED with a real ID/selector
      in `SEL`, and this table updated.
- [ ] `npm run build && npm run lint && npm test` pass (48+ unit tests).
- [ ] A full **dry run** from the Demo Units tab walks every step to
      "stopped before Save" with correct values visible in the step
      screenshots (`~/.abyrx-kairuku/data/debug/run-*/`).
- [ ] One supervised **real** run with a real shipping sheet; the entry is
      visible in Kairuku afterwards; overage sheet untouched unless an
      overage actually occurred.
- [ ] Merged to `main` (ask Will first) and the live artifact rebuilt from
      source per CLAUDE.md — all five tools verified present before publish.
