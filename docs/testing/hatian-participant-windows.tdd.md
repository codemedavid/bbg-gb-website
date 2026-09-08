# Hatian participant windows and the 7-vial verdict — TDD evidence

**Source plan:** none on disk. The requirement came verbatim from the buyers'
group chat, handed to `/ecc:tdd-workflow` on 2026-09-09:

> **~ Peptide_Whisperer:** Paano po list ng mga participants nito? Meron din po
> ba? Sa kahati
> **Jonina:** sa pasalo po?
> **~ Peptide_Whisperer:** Sa kahati po? Then sa pasalo if sino ang nag commit?
> Yon po kasi ang importante — list ng participants na nag place order sa
> hatian. Para alam namin kung sino ang pasok at hindi pumasok sa 7vials?

## What already existed, and what was actually missing

Admin → Group Buys → **👥 Participants & payments** already listed everyone who
committed to a counter — name, contact, address, vials, the three payments,
commit timestamp and proof (`docs/testing/participants-payments.tdd.md`). The
list itself was not the gap. Two things in the chat had no answer on the screen:

1. **"sa pasalo, sino ang nag-commit?"** — the panel never said which of the two
   selling windows a participant committed in. `group_buys.kahati_vials` freezes
   the aggregate split, but no row carried a stage.
2. **"pasok ba sa 7 vials?"** — the panel's only fill figure was *Vials
   remaining*, the gap to the **10-vial cap**. At 5/10 it read "5 remaining"
   while the batch was **two** vials from being ordered. `lib/kahati-quantity.ts`
   names this the expensive confusion: quoting the cap gap "is how a batch four
   vials short gets written off instead of finished".

## Decisions confirmed with the user before any code

- **Admin only.** No participant names go onto the storefront; extend the
  existing panel rather than publish customer identities to other customers.
- **Batch-level qualification.** The 7-vial minimum is a gate on the *counter*,
  not on individuals: at 7+ the batch is ordered and everyone is in, under 7 it
  is cancelled and everyone is refunded (`lib/kahati.ts`). Marking individuals as
  "not in the 7" was rejected as factually wrong — at 8/10 all eight ship.

## User journeys

1. As an admin, I see which participants committed during **Kahati** and which
   during **Pasalo**, so I can answer "sino ang nag-commit sa pasalo?" without
   reading order timestamps by hand.
2. As an admin, I see whether the batch cleared its **7-vial minimum** and how
   many more vials it needs, so "pasok ba sa 7 vials?" has an answer.
3. As an admin, the split I am shown agrees with the **Pasalo close and the
   refund sheet**, so a participant list and a refund never tell two different
   stories.

## Task report

### 1. Reconstructing the per-participant window — `lib/hatian-participants.ts`

There is no `pasalo_opened_at` column to compare a commit time against, and
adding one would answer for **future** batches only — it would read null on every
counter already through the stage, which is exactly the batch someone asks
about. Instead the module walks participants in **commit order** against the
counter's frozen `kahati_vials`: everyone up to that count joined in Kahati,
everyone after was sold by the Pasalo window. That works retroactively on every
counter that has been through the stage.

Three rules, each matching how `lib/kahati-quantity.ts` already resolves the same
ambiguity in aggregate:

- A **null** frozen count means Kahati is still open, so nobody can be filed
  under Pasalo.
- A commitment that **straddles** the boundary stays on the Kahati side — it
  began while Kahati was still running.
- A **cancelled** order does not advance the walk. Cancelling releases the vials
  back to the counter (`app/api/admin/orders/[id]/status/route.ts`), so counting
  them would push live participants across the boundary.

RED — the module did not exist:

```
$ npx vitest run lib/hatian-participants.test.ts
Error: Failed to load url ./hatian-participants (resolved id: ./hatian-participants)
  in .../lib/hatian-participants.test.ts. Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

GREEN:

```
$ npx vitest run lib/hatian-participants.test.ts
 ✓ lib/hatian-participants.test.ts (10 tests) 15ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

### 2. The panel — `app/admin/groupbuys/page.tsx`

Adds a **Window** column with a Kahati/Pasalo badge per participant, the vials
each window brought in, a *Toward the 7-vial minimum* figure, and a sentence
saying what happens next. Qualification is read from the **counter**
(`counterQuantities` on `claimed_slots`), never from the rows in the table,
because `lib/pasalo-server.ts` closes the stage on `claimed_slots` — a panel that
judged the batch by whatever it happened to list would promise an outcome the
close is not going to deliver. The existing *Vials remaining* figure stays put
and keeps answering the other question.

RED:

```
$ npx vitest run app/admin/groupbuys/page.test.tsx
 Tests  8 failed | 35 passed (43)
 Unable to find an element by: [data-testid="stage-o1"]
 Unable to find an element by: [data-testid="summary-minimum"]
 Unable to find an element by: [data-testid="summary-qualification"]
 Unable to find an element by: [data-testid="summary-kahati-vials"]
 Unable to find an element by: [data-testid="summary-pasalo-vials"]
```

GREEN:

```
$ npx vitest run app/admin/groupbuys/page.test.tsx
 ✓ app/admin/groupbuys/page.test.tsx (43 tests) 876ms
 Test Files  1 passed (1)
      Tests  43 passed (43)
```

### 3. Whole-suite and type check

```
$ npx tsc --noEmit --pretty false     # exit 0, no output

$ npx vitest run
 Test Files  286 passed (286)
      Tests  3149 passed (3149)
   Duration  194.30s
```

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | While Kahati is still open, nobody is filed under Pasalo | `lib/hatian-participants.test.ts:calls everyone a Kahati joiner while Kahati is still open` | unit | PASS | `npx vitest run lib/hatian-participants.test.ts` |
| 2 | Participants split at the frozen Kahati count, walked in commit order | `lib/hatian-participants.test.ts:splits participants at the frozen Kahati count, in commit order` | unit | PASS | same |
| 3 | A commitment straddling the boundary stays a Kahati commitment | `lib/hatian-participants.test.ts:keeps a commitment that straddles the boundary on the Kahati side` | unit | PASS | same |
| 4 | A cancelled order never shifts live participants across the boundary | `lib/hatian-participants.test.ts:does not let a cancelled commitment move the boundary` | unit | PASS | same |
| 5 | Stages are decided by commit time, not by the caller's array order | `lib/hatian-participants.test.ts:labels by commit time even when the input is out of order` | unit | PASS | same |
| 6 | A tied commit time is broken on input order, not by `Array#sort` | `lib/hatian-participants.test.ts:breaks a tied commit time on input order` | unit | PASS | same |
| 7 | The walk returns new rows and does not mutate the caller's array | `lib/hatian-participants.test.ts:returns new rows and leaves the caller’s array untouched` | unit | PASS | same |
| 8 | Vials and participants are counted per window | `lib/hatian-participants.test.ts:counts the participants and vials on each side of the split` | unit | PASS | same |
| 9 | A cancelled order's vials count for neither window | `lib/hatian-participants.test.ts:leaves cancelled commitments out of both vial totals` | unit | PASS | same |
| 10 | The split reproduces `counterQuantities` — the figures the Pasalo close uses | `lib/hatian-participants.test.ts:reproduces the counter’s own Kahati/Pasalo figures` | unit | PASS | same |
| 11 | A cancel-during-Pasalo is absorbed on the Kahati side, exactly as the counter absorbs it | `lib/hatian-participants.test.ts:absorbs a cancel-during-Pasalo on the Kahati side, as the counter does` | unit | PASS | same |
| 12 | Each participant is badged Kahati or Pasalo in the panel | `app/admin/groupbuys/page.test.tsx:marks each participant as a Kahati or a Pasalo joiner` | component | PASS | `npx vitest run app/admin/groupbuys/page.test.tsx` |
| 13 | Everyone reads as a Kahati joiner while Kahati runs | `app/admin/groupbuys/page.test.tsx:calls everyone a Kahati joiner while Kahati is still running` | component | PASS | same |
| 14 | The summary totals the vials each window brought in | `app/admin/groupbuys/page.test.tsx:totals the vials each window brought in` | component | PASS | same |
| 15 | Progress counts toward the 7-vial minimum, and the cap figure still answers the other question | `app/admin/groupbuys/page.test.tsx:counts toward the minimum, not toward the cap` | component | PASS | same |
| 16 | The panel says how many more vials the batch needs | `app/admin/groupbuys/page.test.tsx:says how many more vials the batch still needs` | component | PASS | same |
| 17 | The panel says the batch is qualified once the minimum is reached | `app/admin/groupbuys/page.test.tsx:says the batch is qualified once the minimum is reached` | component | PASS | same |
| 18 | Qualification is judged on the counter's claimed vials, not on the listed rows | `app/admin/groupbuys/page.test.tsx:judges the batch by the counter, not by the rows in the table` | component | PASS | same |
| 19 | A counter's own frozen minimum is honoured, not today's constant | `app/admin/groupbuys/page.test.tsx:honours a minimum this counter was created with` | component | PASS | same |

## Coverage

```
$ COLUMNS=200 npx vitest run --coverage --coverage.reporter=text \
    --coverage.include='lib/hatian-participants.ts' \
    --coverage.include='app/admin/groupbuys/page.tsx' \
    --coverage.include='lib/kahati-quantity.ts' \
    lib/hatian-participants.test.ts app/admin/groupbuys/page.test.tsx

File                        | % Stmts | % Branch | % Funcs | % Lines | Uncovered
lib/hatian-participants.ts  |     100 |      100 |     100 |     100 |
lib/kahati-quantity.ts      |     100 |    81.81 |     100 |     100 | 53-54
app/admin/groupbuys/page.tsx|   97.75 |    82.47 |   69.23 |   97.75 | 255,258,466-472
```

`lib/hatian-participants.ts` is at 100% on every axis. Both other files clear the
80% statement/line target; `page.tsx` function coverage (69.23%) is the
pre-existing figure for the whole page module — form submit handlers and delete
confirmations this change does not touch.

## Known gaps

- **No browser/visual pass was run.** The panel table gained a column and its
  minimum width moved from 1100px to 1200px. The component tests assert the DOM
  through the real page component, but nothing here checks the rendered layout at
  the 320/768/1024/1440 breakpoints. Reproducing it needs a dev server on PGlite
  (`DATABASE_URL= STORAGE_DRIVER=local`), an admin login, and a counter seeded
  with `status='pasalo'` and a non-null `kahati_vials`.
- **The Pasalo attribution is a reconstruction, not a record.** Where a Kahati
  participant cancels during Pasalo, the tail of the list reads as Kahati rather
  than Pasalo. This is deliberate and pinned by test #11: `counterQuantities`
  absorbs that same shortfall on the Kahati side, and a panel that guessed
  differently would describe a refund the refund sheet is not making. A
  `pasalo_opened_at` column would make it exact for *future* batches only.
- **No migration and no API change.** Everything is derived from columns that
  already exist, so there is no prod schema drift to apply before deploying.

## Merge evidence

Four checkpoint commits on `main`, RED before GREEN in both cycles:

```
39a5afc test: require a Kahati/Pasalo split on the hatian participant list      (RED)
e8c768f feat: reconstruct the Kahati/Pasalo split per hatian participant        (GREEN)
9bd7c7e test: require the participants panel to answer the Kahati/Pasalo question (RED)
0c094f3 feat: show the Kahati/Pasalo window and the 7-vial verdict on the panel (GREEN)
```
