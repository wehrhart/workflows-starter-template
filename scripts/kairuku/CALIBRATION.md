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

### CONFIRMED from Will's live screenshots (2026-07-13)

- Product options are exactly `MONTAGE` / `MONTAGE Fast Set` /
  `MONTAGE Flowable` — `productMontage` and `productFlowable` regexes are
  safe (anchored match can't hit "Fast Set").
- Verify does NOT navigate: it reveals a Status panel (training info,
  demos sent this quarter/all time) with a "CONTINUE TO ADD" button on the
  same page. `btnContinue` text confirmed.
- Rep option format is `Last, First (Distributor Name)` —
  `matchesLastFirst` handles the parenthetical suffix.
- Continue to Add opens the "Demo Tracking Sheet" page (breadcrumb:
  Demo Tracking Sheets > Edit Demo Tracking Sheet). Field labels confirmed:
  `Notes*`, `Tracking Number`, `Units*`, `Closed / This Request is
  Fulfilled` checkbox, `Item` dropdown (prefilled with the SKU, e.g.
  OS-MON-1604), `Date of Transfer`, Origin/Destination Type radios and
  Destination + Sales Rep dropdowns (all prefilled correctly).
- ⚠ That page has THREE "SAVE" buttons (Add Individual UID, Add UID Range,
  and the real SAVE next to CANCEL) — the runner uses `clickMainSave()`
  (the SAVE paired with CANCEL), never first-match text.
- ⚠ Page title/breadcrumb contain "Tracking" — `labelTracking` must stay
  anchored to `/^tracking number/i`.

### RESOLVED (Will's full-window screenshots, 2026-07-13)

- Demo Check page URL confirmed: `beta.kairuku.com/chargesheets.aspx`
  (`demoPagePath` is correct).
- Top nav confirmed: DASHBOARD · DISTRIBUTORS & SALES REPS · LOGOUT —
  `navDashboard` text-match is correct.
- **UIDs: per Will, the manual workflow never enters UIDs.** The
  "Entered number of UIDs (0) does not match Units" warning is ignorable;
  the runner never touches the Demo Unit Information box (and its two SAVE
  buttons are exactly why `clickMainSave()` exists).
- **"Continue to Add" DOES create a record**: it lands on
  `demosheet.aspx?ID=<number>` — a real row ID minted before Save. This is
  why `cancelOut()` (the page's CANCEL button) is the mandatory back-out in
  dry-run and on mid-final-page failure, never plain navigation.

### STILL UNCONFIRMED

| Item | Status |
|------|--------|
| `btnOverage` "Request Overage" | no overage case captured yet — text is still the spec's wording. Deliberately NOT forcing one on a real rep. If a real overage renders differently, the run's failure box provides the fix in one paste. |
| CANCEL discards the draft row | assumed (standard semantics); verify after the first cancelled walk-through that no stray row appears in the Demo Units list. |

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
