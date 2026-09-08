# Kahati + Pasalo combined report — TDD evidence

**Source plan:** no `*.plan.md` on disk. The scope came from `/ecc:plan` earlier
in the same session and a client decision the user relayed:

> *"ok so i talked with the client and i came up that the kahati and pasalo will
> have the same report since the vials we fill in using the pasalo is the vials
> needed in the kahati"*

followed by *"ok so implement the kahati and pasalo report combined"*.

## What was already true, and what was actually missing

Verified before writing anything: **the reports were already combined.**

- `/api/pasalo` is a read-only board (GET only), not a checkout. Pasalo joins go
  through the same `/api/orders` checkout as Kahati — `orders/route.ts:376`
  guards with `isJoinableKahatiStatus`, which accepts both `'open'` and
  `'pasalo'` (`lib/pasalo.ts:56`).
- A Pasalo commitment is a line against a `group_buys` counter → `kind:
  'group_buy'` → `modeOf` returns `'kahati'` (`lib/order-modes.ts:16-17`) →
  `buyType = draft.mode` (`orders/route.ts:533`).
- `segmentOfOrder` sends `buyType === 'kahati'` to the Kahati segment
  (`lib/report/segment.ts:41-45,72`), so Pasalo vials were already in the Kahati
  `productTotals` — exactly the client's reasoning.

So no data work was needed. Two real gaps remained:

1. **Nothing pinned it.** A future `'pasalo'` buy type or a fourth
   `REPORT_SEGMENTS` entry would split the batch order silently. The failure
   mode is a wrong number, not an exception — the supplier is under-ordered and
   nothing throws.
2. **The report could not name its own halves.** A sheet headed "Kahati"
   carried Pasalo vials with no indication, so a combined report was combined by
   accident rather than by design.

## User journeys

1. As an admin, I read one Kahati report that already contains the Pasalo
   commitments, so the batch order counts the vials Pasalo filled in.
2. As an admin, I can see how much of that batch came from Pasalo, so a combined
   report still shows me its two halves.
3. As a developer, I cannot silently split Pasalo into its own segment later and
   under-order the supplier.

## Task report

### 1. The stage split — `lib/report/kahati-stage.ts`

Splits a segment's counter vials into the stage that sold them, walking **each
counter against its own frozen `kahati_vials`**. Computed through
`lib/hatian-participants.ts` — the same module the admin participants panel and
`pasaloFailureReason` use — so a batch sheet and a refund cannot disagree about
the same vials.

RED — the module did not exist:

```
$ npx vitest run lib/report/kahati-stage.test.ts
Error: Failed to load url ./kahati-stage (resolved id: ./kahati-stage)
  in .../lib/report/kahati-stage.test.ts. Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

GREEN:

```
$ npx vitest run lib/report/kahati-stage.test.ts
 ✓ lib/report/kahati-stage.test.ts (7 tests) 14ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

### 2. Wiring it through the report and onto the card

`WeeklyReport` gains `kahatiStage`; the weekly query carries the counter id and
its frozen count (the join to `group_buys` already existed for the vial cap);
the Kahati card states the split.

RED:

```
$ npx vitest run lib/report/build.test.ts
× reports the vials each stage brought in
  → expected undefined to match object { kahatiVials, pasaloVials, ... }
× carries the Pasalo vials in the KAHATI half, not a half of their own
  → expected undefined to match object { kahatiVials: 3, pasaloVials: 2 }

$ npx vitest run app/admin/reports/SegmentReport.test.tsx
× says the Kahati report includes Pasalo, and how much of it is Pasalo
  → Unable to find an element by: [data-testid="kahati-stage-split"]
```

GREEN (all affected targets together):

```
$ npx vitest run lib/report/kahati-stage.test.ts lib/report/build.test.ts \
    lib/report/segment.test.ts app/admin/reports/SegmentReport.test.tsx \
    app/admin/reports/page.test.tsx app/admin/reports/OrderSummaryReport.test.tsx \
    app/admin/orders/WeeklyReportButton.test.tsx
 Test Files  7 passed (7)
      Tests  61 passed (61)
```

### 3. The regression guard — characterization, not RED-driven

The three tests added to `lib/report/segment.test.ts` **passed on unchanged
code** (14 passed at the RED commit). They are recorded here as characterization
tests rather than presented as a RED/GREEN cycle. They exist because nothing
else pins the client's decision.

### 4. Whole-suite and type check

```
$ npx tsc --noEmit --pretty false     # exit 0, no output

$ npx vitest run
 Test Files  288 passed (288)
      Tests  3164 passed (3164)
   Duration  181.92s
```

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | A range with no counter commitments reports no stage vials | `lib/report/kahati-stage.test.ts:reports nothing for a range with no counter commitments` | unit | PASS | `npx vitest run lib/report/kahati-stage.test.ts` |
| 2 | A counter that never reached Pasalo has all its vials counted as Kahati | `…:counts every vial as Kahati while the counter never went to Pasalo` | unit | PASS | same |
| 3 | A counter through Pasalo splits at its frozen Kahati count | `…:splits a counter that went through Pasalo at its frozen Kahati count` | unit | PASS | same |
| 4 | Each counter is walked against its own boundary, never one global pass | `…:walks each counter against its own boundary` | unit | PASS | same |
| 5 | A cancelled order's vials count for neither stage | `…:leaves a cancelled order out of both stages` | unit | PASS | same |
| 6 | On-hand and MOQ lines are not counted as vials any stage filled | `…:ignores lines that reference no counter` | unit | PASS | same |
| 7 | The two halves always sum to the total, never change it | `…:always splits the total, never changes it` | unit | PASS | same |
| 8 | A built report exposes the vials each stage brought in | `lib/report/build.test.ts:reports the vials each stage brought in` | unit | PASS | `npx vitest run lib/report/build.test.ts` |
| 9 | Pasalo vials live in the Kahati half only — never double-counted into another | `lib/report/build.test.ts:carries the Pasalo vials in the KAHATI half, not a half of their own` | unit | PASS | same |
| 10 | A Pasalo-stage commitment is filed under Kahati | `lib/report/segment.test.ts:files a commitment made during the Pasalo stage under Kahati` | unit (characterization) | PASS | `npx vitest run lib/report/segment.test.ts` |
| 11 | A counter commitment files under Kahati even with no buy type recorded | `…:files a counter commitment under Kahati even with no buy type recorded` | unit (characterization) | PASS | same |
| 12 | Pasalo has no segment of its own and no buy type of its own | `…:gives Pasalo no segment of its own` | unit (characterization) | PASS | same |
| 13 | The Kahati card says it includes Pasalo, and how much of it is Pasalo | `app/admin/reports/SegmentReport.test.tsx:says the Kahati report includes Pasalo…` | component | PASS | `npx vitest run app/admin/reports/SegmentReport.test.tsx` |
| 14 | The split is not shown on a report that holds no counters | `…:does not put the stage split on a report that has no counters` | component | PASS | same |

## Coverage

```
File                          | % Stmts | % Branch | % Funcs | % Lines | Uncovered
lib/report/kahati-stage.ts    |     100 |      100 |     100 |     100 |
lib/report/segment.ts         |   94.59 |      100 |   66.66 |   94.59 | 49-50
app/admin/reports/SegmentReport.tsx | 97.72 | 37.5 | 33.33 |   97.72 | 37
```

`kahati-stage.ts` is at 100% on every axis. `segment.ts` lines 49-50 are
`isReportSegment`, exercised by the route tests rather than this file.
`SegmentReport.tsx` branch/function coverage is low **in this scoped run only** —
its download and print handlers are covered by `app/admin/reports/page.test.tsx`,
which is not in the scoped include.

## Known gaps

- **No browser/visual pass.** The Kahati card gained a paragraph. Component
  tests assert the real DOM, but nothing checks it at the 320/768/1024/1440
  breakpoints.
- **The stage split is a reconstruction.** It inherits the documented limit of
  `lib/hatian-participants.ts`: where a Kahati participant cancels during Pasalo,
  the shortfall is absorbed on the Kahati side. That is deliberate — it is the
  direction `counterQuantities` takes, so the report agrees with the refund
  sheet.
- **The Excel workbook does not carry the split.** Only the on-screen card does.
  Adding a stage column to the order sheet or a line to the Summary sheet was
  not asked for and was left out.
- **No migration.** Everything derives from existing columns, so there is no
  prod schema drift to apply before deploying.

## Merge evidence

```
(RED)   test: require the Kahati report to show its Pasalo half
(GREEN) feat: split a Kahati batch's vials into its Kahati and Pasalo halves
(RED)   test: require the combined report to name its Pasalo half
(GREEN) feat: name the Pasalo half on the combined Kahati report
```
