# COA page — TDD record

**Task:** 2026-09-09, two messages:

> the coa page under the customer feedback in the home page where is it

> yes build the coa page the admin can upload an image to the coa page and it should
> open in the website only no third party website like imagekit

**Source plan:** none. The journeys below were derived during this TDD run, the first
of them from what the codebase turned out to actually contain.

## What was there before

There was no COA page, and nothing COA-shaped under the Customer feedback card on the
home page. `git log -S coa -- "app/(storefront)/page.tsx"` returns nothing: one never
existed there. What existed was:

| Where | What it did |
|---|---|
| `app/product/[id]/page.tsx:121` | A "COA — Certificate of Analysis" button on one product. With no `coaFiles` row it toasted *"COA for this batch is available on request."* |
| `app/api/coa/[id]/download/route.ts` | Redirected one row to `/api/files/coa-files/<key>` — already this site's own path |
| `app/(storefront)/orders/page.tsx:139` | A "📄 Download COA" button wired to nothing: it toasts *"COA available on the product page or on request."* |
| `app/(storefront)/account/page.tsx:95` | The words "download COA" in a subtitle |

So the answer to "is this batch tested?" was a message to the admin. The lab result is
the evidence the group buy runs on; it now has a page.

## User journeys

1. As someone deciding whether to join a batch, I want to see the lab certificate for
   it **without logging in**, so that I can check it before I have an account.
2. As a customer opening a certificate, I want it to open **on bbgph.org**, so that the
   document proving BBG tested the batch does not arrive from a host I have never heard
   of.
3. As the admin, I want to upload a certificate image against a batch (and optionally a
   product), so that customers stop asking me for it one message at a time.
4. As the admin, I want to delete one I uploaded by mistake, because a wrong lab sheet
   under a real batch label is worse than none.
5. As a customer, I want to reach the certificates **from the home page, under the
   Customer feedback card**, which is where I was told they would be.

## Decisions worth recording

- **No migration.** `coa_files` has existed since migration `0000`, so the page reads
  rows production already has. Given this project's history of 5–7s Vercel "Error"
  builds from schema drift, a feature that needs no new column is the feature that
  ships. `file_name` carries the admin's label (or the uploaded file's own name); the
  column predates the page, when a COA was only ever a PDF attached to a product.
- **No hide toggle**, unlike the feedback gallery. A half-published lab result is worse
  than none: it is a batch whose paperwork exists but cannot be produced. Unpublishing
  is deleting. (`lib/coa-server.ts`)
- **Uploads are images**; legacy PDF rows still list, flagged `isImage: false`, and get
  a document tile rather than an `<img>` that would render a broken-image icon over the
  one file the customer came to read.
- **The URL is built by `siteFileUrl`, never `signedUrl`.** Under the production
  ImageKit driver `signedUrl` returns `ik.imagekit.io`. `lib/file-url.ts` already put
  `coa-files` in `PUBLIC_BUCKETS`, so `/api/files/coa-files/<key>` streams the bytes to
  a logged-out visitor through this site.

## RED

`npx vitest run app/api/admin/coa/route.test.ts "app/(storefront)/coa/page.test.tsx" "app/(storefront)/page.test.tsx"`

```
 ❯ app/api/admin/coa/route.test.ts (0 test)
 ❯ app/(storefront)/coa/page.test.tsx (0 test)

Error: Failed to resolve import "./page" from "app/(storefront)/coa/page.test.tsx". Does the file exist?
Error: Failed to load url ./route (resolved id: ./route) in app/api/admin/coa/route.test.ts. Does the file exist?

 Test Files  3 failed (3)
      Tests  3 failed | 5 passed (8)
```

Compile-time RED for the two new suites (the subject does not exist), runtime RED for
the three home-page assertions (`Unable to find an element with the text: /^COA/`).
Committed as `e8961a2 test: reproduce the missing COA gallery`.

## GREEN

`npx vitest run app/api/admin/coa app/(storefront)/coa app/(storefront)/page.test.tsx app/admin/coa app/admin/layout.test.tsx`

```
 ✓ app/(storefront)/coa/page.test.tsx (7 tests)
 ✓ app/(storefront)/page.test.tsx (8 tests)
 ✓ app/admin/coa/page.test.tsx (5 tests)
 ✓ app/admin/layout.test.tsx (6 tests)
 ✓ app/api/admin/coa/route.test.ts (14 tests)
```

Full suite: `npx vitest run` → **296 files, 3286 tests passing** before the admin-page
suite existed; 297/3291 after it. `npx tsc --noEmit` clean.
Committed as `71bdc22 feat: publish every batch's COA on its own page`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | An uploaded certificate comes back under this site's own path, with **no scheme and no host** — not merely "not imagekit" | `app/api/admin/coa/route.test.ts:stores the uploaded certificate and returns it under this site's own URL` | integration | PASS |
| 2 | The row is real and the URL was built from its stored key | same test, DB assertion | integration | PASS |
| 3 | A certificate uploaded with no label is listed under the file's own name, never blank | `:falls back to the uploaded file name when the admin types no label` | integration | PASS |
| 4 | A COA filed against a product reports that product by name | `:files the certificate against a product, and reports that product by name` | integration | PASS |
| 5 | A product deleted out from under the form gives a 404 naming the product, not a 500 from the foreign key | `:refuses a product that no longer exists instead of failing on the foreign key` | integration | PASS |
| 6 | A COA row cannot be created without a document | `:requires a file — a COA row with no document is not a COA` | integration | PASS |
| 7 | A non-image upload is rejected | `:rejects a file that is not an image` | integration | PASS |
| 8 | Upload is admin-only (403 customer, 401 anonymous) | `:is closed to customers and to anonymous visitors` | integration | PASS |
| 9 | A **logged-out** visitor can read the list | `GET /api/coa:lists the certificates to a logged-out visitor` | integration | PASS |
| 10 | Newest batch first, with a stable tiebreak | `:puts the newest batch first` | integration | PASS |
| 11 | A legacy PDF row still serves from this site and is flagged not-an-image | `:serves a legacy PDF certificate from this site too` | integration | PASS |
| 12 | The storage key is not a field a client could send to the CDN | `:never exposes the storage key as a field a client could send to the CDN` | integration | PASS |
| 13 | Delete removes it; unknown id 404s; customers get 403 and the row survives | `DELETE /api/admin/coa/:id` ×3 | integration | PASS |
| 14 | The page lists label, batch and the product it belongs to | `app/(storefront)/coa/page.test.tsx:lists a certificate with its batch and the product` | unit | PASS |
| 15 | The certificate itself is shown, from the site URL | `:shows the certificate itself, not just its name` | unit | PASS |
| 16 | **Every certificate link on the page is relative** — no scheme, no host | `:opens the certificate on this site — never on a storage host` | unit | PASS |
| 17 | A PDF gets a document tile, not a broken image, and still opens | `:renders a document tile for a PDF certificate` | unit | PASS |
| 18 | Empty and loading states are distinct | `:says so plainly when nothing has been published yet`, `:does not show the empty state while the list is still loading` | unit | PASS |
| 19 | The COA card sits on the home page **directly under Customer feedback** and opens `/coa` | `app/(storefront)/page.test.tsx` ×3 | unit | PASS |
| 20 | The admin form sends the file under the multipart field the route reads (`file`), with label, batch and product | `app/admin/coa/page.test.tsx:sends the certificate under the field the route reads` | unit | PASS |
| 21 | The form refuses to upload with no document, and shows a rejected upload's reason inside the form | `:refuses to upload a COA row with no document`, `:shows the failure reason in the form` | unit | PASS |
| 22 | Deleting asks first and only then pulls the certificate | `:asks before pulling a certificate off the public page, then pulls it` | unit | PASS |

## Coverage

`npx vitest run --coverage` over the four suites:

| File | % Stmts | % Branch | % Lines |
|---|---|---|---|
| `app/(storefront)/coa/page.tsx` | 100 | 86.66 | 100 |
| `app/admin/coa/page.tsx` | 99.21 | 83.33 | 99.21 |
| `app/api/admin/coa/route.ts` | 100 | 91.66 | 100 |
| `app/api/admin/coa/[id]/route.ts` | 100 | 100 | 100 |
| `app/api/coa/route.ts` | 100 | 100 | 100 |
| `lib/coa.ts` | 100 | 100 | 100 |
| `lib/coa-server.ts` | 100 | 100 | 100 |

## Known gaps

- **`app/admin/coa/page.test.tsx` was written after the screen**, not before, so it is
  regression cover rather than RED-driven. Its discriminating power was verified by
  mutation instead: renaming the multipart field from `file` to `image` in the form
  fails guarantee 20 — which is exactly the 400 ("An image file is required.") an admin
  would otherwise read as their PNG being rejected as a PNG. Reverted after the check.
- **No browser pass.** Nothing here was clicked in a real browser against PGlite; the
  upload path is proven against real PGlite and the real `local` storage driver in the
  API suite, and the two screens against mocked data.
- **A deleted row leaves its file in the bucket.** Deliberate — nothing links to it once
  the row is gone — but it means the bucket grows.
- **Upload is image-only.** Labs email PDFs; those must be screenshotted, or
  `lib/uploads.ts` needs a PDF-aware sibling. Legacy PDF rows already display.
- **No pagination.** A hand-curated gallery of tens of rows, so the whole list is read.
  The same call this project already makes for the feedback gallery.
- The product page's own COA button was left exactly as it was; it was not in scope.
