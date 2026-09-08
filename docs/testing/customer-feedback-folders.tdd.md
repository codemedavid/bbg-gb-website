# Customer feedback folders — TDD evidence

**Source plan:** none on disk. The journeys were agreed in-session via `/ecc:plan`
("add a feedback page where admin can upload the customer feedback and it will
show in the feedback page under the order calculator"), plus a follow-up
requirement: *"the admin can add a folder in the feedback page so that each
feedback is organized at its respective folder — the layout will be feedbacks →
folders."*

Two decisions were confirmed with the user before any code was written:

- One feedback = **screenshot + optional caption + optional credit**.
- Customers reach it via **its own `/feedback` page**, entered from a card on
  Home **directly under the Order calculator card**.

## User journeys

1. As an admin, I create a folder on the Feedback page, so each batch's feedback
   is filed in its own place.
2. As an admin, I upload a customer's screenshot into a folder with an optional
   caption and credit.
3. As an admin, I hide a folder or a single feedback without deleting it.
4. As a customer, I open Feedback from Home under the Order calculator, browse
   folders, and open one to see the screenshots.
5. As a customer, I never see a hidden folder or a hidden feedback.

## Task report

### 1. Schema, storage bucket and serializers

Two tables (`feedback_folders`, `feedback_items`) plus a new public `feedback`
storage bucket; serializers turn the stored image key into a URL.

- **RED:** `npx vitest run lib/feedback.test.ts` →
  `Error: Failed to load url ./feedback … Does the file exist?` (0 tests, suite
  failed to collect).
- **GREEN:** same command → `✓ lib/feedback.test.ts (7 tests)`.
- **Guarantees:** a stored key always resolves to a URL the browser can render;
  the raw key never reaches the client; an empty folder serializes to
  `coverUrl: null, itemCount: 0` instead of throwing on a missing first element.

Two tables rather than one with a text `folder` column: a folder has to exist,
be renamed, be reordered and be hidden **while it is still empty**, and a column
on the items cannot represent a folder nothing has been filed into yet.

### 2. API layer

Four admin routes (folder CRUD + multipart item CRUD) and two public routes.

- **RED:** `npx vitest run app/api/admin/feedback/route.test.ts` →
  `Error: Failed to load url ./folders/route` (0 tests).
- **GREEN:** same command → `✓ (25 tests)`, later `✓ (29 tests)` after the
  admin folder-detail GET was added by the same RED→GREEN cycle
  (`TypeError: ADMIN_FOLDER is not a function` → pass).
- **Guarantees:** admin-only writes (403 customer / 401 anonymous); an empty
  folder survives a round trip; the hide toggle is enforced **server-side** on
  both folders and items; a hidden folder 404s on its own public URL; deleting a
  folder cascades to its screenshots; an upload with no image or a non-image
  file is rejected; an edit that sends no new file keeps the stored screenshot.

The visibility rule lives in exactly one file, `lib/feedback-server.ts` —
`activeOnly` is the difference between what an admin manages and what a customer
may see, and four routes each re-deriving it is how a pulled screenshot gets
republished.

### 3. Storefront gallery and the home entry point

- **RED:** `npx vitest run "app/(storefront)/feedback"` → 2 suites failed to
  collect (pages did not exist). `npx vitest run "app/(storefront)/page.test.tsx"`
  → 3 failed, `Unable to find an element with the text: Customer feedback`.
- **GREEN:** `✓ page.test.tsx (6 tests)`, `✓ [id]/page.test.tsx (6 tests)`,
  `✓ (storefront)/page.test.tsx (3 tests)`.
- **Guarantees:** a folder nobody has uploaded into still renders a tile a
  customer can open; captions and credits reach the page; screenshots lazy-load;
  a screenshot opens full-size on tap and can be closed again; the home card sits
  **after** the Order calculator (asserted by DOM order, not mere presence).

One test-harness note: the `[id]` page reads its route param with `use(params)`,
so it suspends. The test needs both a `Suspense` boundary and an `await act()`
around `render` — the pattern already established in
`app/(storefront)/orders/[id]/page.test.tsx`. Without the `act()` wrapper the
page stays on the fallback and every assertion races an empty tree.

### 4. Admin screen

- **RED:** `npx vitest run app/admin/feedback/page.test.tsx` → suite failed to
  collect (page did not exist).
- **GREEN:** `✓ (13 tests)`, then `✓ (15 tests)` after the coverage backfill.
- **Guarantees:** folders list with their counts and a Hidden badge; a folder
  cannot be saved without a name; an upload cannot be saved without a
  screenshot; the upload form warns that the gallery is public **before**
  anything is uploaded; the folder-delete confirm **names the screenshot count**
  and points at the Active tick-box as the non-destructive alternative; backing
  out of the confirm deletes nothing.

Two ambiguous queries surfaced a real accessibility gap: the folder name and the
"Hidden" badge each appeared in both panes with nothing to tell the two lists
apart. Fixed in the implementation by giving both lists accessible names
(`Feedback folders`, `Feedback in this folder`), not by loosening the assertions.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A stored image key resolves to a renderable URL; the key itself never reaches the client | `lib/feedback.test.ts:resolves the stored image key into a URL the browser can render` | unit | PASS |
| 2 | An empty folder serializes with no cover and a zero count | `lib/feedback.test.ts:has no cover and no count when the folder is empty` | unit | PASS |
| 3 | An empty folder survives a create round trip | `app/api/admin/feedback/route.test.ts:creates an empty folder…` | integration | PASS |
| 4 | Folder writes refuse customers (403) and anonymous visitors (401) | `…route.test.ts:refuses a customer and an anonymous visitor` | integration | PASS |
| 5 | The admin list includes hidden folders so they can be unhidden | `…route.test.ts:lists hidden folders too…` | integration | PASS |
| 6 | Deleting a folder deletes its screenshots (cascade) | `…route.test.ts:takes the folder's screenshots with it…` | integration | PASS |
| 7 | An upload with no screenshot is rejected | `…route.test.ts:refuses a feedback with no screenshot…` | integration | PASS |
| 8 | A non-image file is rejected | `…route.test.ts:refuses a file that is not an image` | integration | PASS |
| 9 | An upload into a non-existent folder 404s instead of orphaning | `…route.test.ts:404s rather than orphaning a screenshot…` | integration | PASS |
| 10 | Editing without a new file keeps the stored screenshot | `…route.test.ts:keeps the existing screenshot when the edit sends no new file` | integration | PASS |
| 11 | The public list never includes a hidden folder | `…route.test.ts:never lists a hidden folder` | integration | PASS |
| 12 | Public counts and covers skip hidden screenshots | `…route.test.ts:counts and covers only the screenshots customers can actually see` | integration | PASS |
| 13 | A hidden folder 404s on its own public URL | `…route.test.ts:404s on a hidden folder, so its URL cannot be shared around the toggle` | integration | PASS |
| 14 | The admin folder view includes hidden screenshots | `…route.test.ts:includes the hidden screenshots…` | integration | PASS |
| 15 | An unfilled folder still renders an openable tile | `app/(storefront)/feedback/page.test.tsx:still renders a folder nobody has uploaded into yet` | component | PASS |
| 16 | Captions and credits render with each screenshot | `app/(storefront)/feedback/[id]/page.test.tsx:renders every screenshot with what the customer said and who said it` | component | PASS |
| 17 | Screenshots lazy-load | `…[id]/page.test.tsx:lazy-loads the screenshots…` | component | PASS |
| 18 | A screenshot opens full-size and can be closed again | `…[id]/page.test.tsx:opens a screenshot full-size when tapped` + the two close cases | component | PASS |
| 19 | The home feedback card sits after the Order calculator | `app/(storefront)/page.test.tsx:puts the feedback card directly under the order calculator` | component | PASS |
| 20 | The folder-delete confirm names the screenshot count | `app/admin/feedback/page.test.tsx:names the number of screenshots a folder delete will destroy` | component | PASS |
| 21 | Backing out of the confirm deletes nothing | `app/admin/feedback/page.test.tsx:does not delete when the admin backs out` | component | PASS |
| 22 | The upload form warns the gallery is public before upload | `app/admin/feedback/page.test.tsx:warns that screenshots reach a public page…` | component | PASS |
| 23 | An upload cannot be saved without a screenshot | `app/admin/feedback/page.test.tsx:refuses to upload without a screenshot…` | component | PASS |

## Coverage

```
npx vitest run --coverage --coverage.include='lib/feedback*.ts' \
  --coverage.include='app/api/**/feedback/**/*.ts' \
  --coverage.include='app/(storefront)/feedback/**/*.tsx' \
  --coverage.include='app/admin/feedback/*.tsx' \
  --coverage.exclude='**/*.test.*' \
  lib/feedback.test.ts app/api/admin/feedback/route.test.ts \
  "app/(storefront)/feedback" app/admin/feedback/page.test.tsx

Tests  65 passed (65)
All files | 98.23 % Stmts | 83.41 % Branch | 84.61 % Funcs | 98.23 % Lines
```

Every API route file is at 100% statements. The remaining uncovered lines are
loading branches in the two page components.

## Whole-suite and build

```
npx tsc --noEmit --pretty false      → clean (exit 0)
npm test                             → 3126 passed, 1 failed (285 files)
npx next build                       → success; /feedback 1.29 kB (125 kB first load),
                                       /feedback/[id] 1.42 kB (125 kB)
```

The single whole-suite failure is
`app/api/orders/packing-fee-cycle.test.ts:charges the cycle fee again in the
next cycle`. It is **not caused by this work**:

- it passes 10/10 when run alone (`npx vitest run app/api/orders/packing-fee-cycle.test.ts`);
- the file contains zero references to feedback, and the two new tables are
  touched by nothing else in the schema.

It matches the known whole-suite flake pattern already recorded for the Pasalo
refund suite: re-run the file alone before chasing it.

## Known gaps and follow-ups

- **Migration 0032 is not applied to any database yet.** Applying it to
  production is required *before* the deploy: `prebuild` runs `db:check`, and a
  production database without these tables fails the Vercel build in ~5–7s with
  a bare "Error". Same sequence used for 0031.
- **Local dev** needs `db:push` against PGlite with the dev server stopped
  (PGlite is single-writer, and `drizzle/*.sql` is not auto-applied locally).
  Do not run it against the production `DATABASE_URL` in `.env`.
- **ImageKit** — `/bbg-groupbuy/feedback/` is created on first upload, but
  `npm run imagekit:setup` provisions it up front now that the bucket is in the
  provisioning loop.
- **No browser QA run yet.** Not attempted deliberately: it needs a dev server
  on local PGlite, and other sessions work in this repo concurrently.
- **Image weight is untested.** The gallery lazy-loads at fixed aspect ratios,
  but nothing downsizes an unedited camera-roll PNG. If the folders get large,
  the follow-up is a `thumbUrl` from an ImageKit transformation — deliberately
  left out to keep this diff to the approved plan.
- **Privacy is procedural, not enforced.** The upload form warns that the page
  is public and the hide toggle makes a pull instant and reversible, but nothing
  detects a phone number left in a screenshot.

## Merge evidence

Checkpoint commits on `main`, in order:

```
9d890ab test: require the feedback serializers to resolve stored image keys   (RED)
8d75f48 feat: store customer feedback in admin-created folders                (GREEN)
4daf8e1 test: require the feedback APIs to enforce folders and the hide toggle (RED)
134b7e6 feat: serve customer feedback folders to admin and storefront         (GREEN)
f1227ce test: require the feedback gallery and its home entry point           (RED)
e431c0d feat: show customer feedback folders on the storefront                (GREEN)
372e0f2 test: require the admin feedback screen to guard folder deletes       (RED)
e9ed6d5 feat: add the admin screen for filing customer feedback               (GREEN)
3310e53 test: cover the close and edit paths of the feedback screens          (refactor)
```
