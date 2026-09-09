# Reviews and COAs served from bbgph.org — TDD evidence

**Source plan:** none. Requirement given verbatim: *"make sure the coa and the
reviews is viewable in the website of bbg no other website like imagekit just to
open and view the image."*

## The defect

`signedUrl()` (`lib/storage.ts:81`) answers "give me a URL that works". Under the
**ImageKit driver — which is production** — that is an `ik.imagekit.io` URL. The
image still rendered inside the page, but the URL belonged to somebody else:
opening it in a new tab, long-pressing it, or sharing it took a customer off
bbgph.org onto a CDN host they have never heard of. That included the COA, the
document whose entire job is to prove the batch was third-party tested.

A same-origin route already existed — `app/api/files/[bucket]/[...key]` — but it
could not serve these two galleries for two reasons:

1. It read **local disk only** (`readLocal`), so under the ImageKit driver it
   404'd on every real file.
2. It required a **session**, because it was written for payment proofs. A
   logged-out visitor browsing reviews is the normal case, not an intrusion.

### Why the existing tests did not catch it

`vitest.config.ts` sets `STORAGE_DRIVER=local`, where `signedUrl` already returns
a relative path. Every existing feedback test therefore saw a same-origin URL
while production did the opposite — the same shape as the documented
pglite-vs-postgres driver gap. Both new test files force
`storageDriver: 'imagekit'` for exactly that reason.

## User journeys

1. As a customer, tapping a review or COA opens it on bbgph.org, never on
   ik.imagekit.io.
2. As a logged-out visitor, I can still view reviews and COAs — they are public
   marketing material.
3. As anyone, payment proofs stay private: making files public must not leak
   them.

## Task report

### 1. Same-origin URLs — `lib/file-url.ts`

A pure module that consults no driver, which is the point, since the driver is
what was leaking the host. Public buckets are an **allowlist**, never a
denylist: the difference between "these two are public" and "everything except
proofs is public" is one forgotten bucket away from publishing screenshots of
people's bank apps.

RED (module missing) → GREEN:

```
$ npx vitest run lib/file-url.test.ts lib/feedback.test.ts
 Test Files  1 failed (1)      ->   Test Files  2 passed (2)
      Tests  no tests                    Tests  13 passed (13)
```

### 2. The file route serves public galleries

RED:

```
$ npx vitest run app/api/files
× serves a review image to a visitor who is not logged in -> expected 401 to be 200
× serves a COA to a visitor who is not logged in          -> expected 401 to be 200
× reads through the storage driver                        -> spy not called
× refuses a traversal attempt even on a public bucket     -> expected 401 to be 400
```

The three `private files stay private` tests passed on unchanged code. They are
recorded as guards, not driven failures.

GREEN, after adding `readFile()` to `lib/storage.ts` (driver-aware: local disk
for the local driver, a server-side fetch otherwise, so the credential never
reaches the customer):

```
$ npx vitest run app/api/files
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

Two behaviours changed beyond the ask, both deliberate:
- Path traversal is rejected **before** the session check, so a bad path reads as
  a bad path rather than as an authentication failure.
- Public files are cached `immutable` for a year. A stored file never changes
  under its key — a new upload gets a new one — and without this the proxy would
  cost a storage fetch per scroll.

### 3. The COA download stays on this site

RED:

```
$ npx vitest run app/api/coa
× keeps the customer on this site
  -> expected '/' to be '/api/files/coa-files/coa/batch-7.pdf'
```

GREEN: `Tests 2 passed (2)`.

### 4. Whole-suite and type check

```
$ npx tsc --noEmit --pretty false     # exit 0

$ npx vitest run
 Test Files  292 passed (292)
      Tests  3214 passed (3214)
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Reviews and COAs are readable by any visitor | `lib/file-url.test.ts:publishes the galleries built to be looked at` | unit | PASS |
| 2 | **Payment proofs are never public** | `…:keeps payment proofs private` | unit | PASS |
| 3 | A bucket nobody named stays private | `…:keeps a bucket nobody named private` | unit | PASS |
| 4 | The URL points at this site, with no storage host in it | `…:points at this site, not at a storage host` | unit | PASS |
| 5 | A key with a space is escaped, slashes preserved | `…:escapes a key with a space…` | unit | PASS |
| 6 | A review image is same-origin **under the production driver** | `…:is served from bbgph.org, not from ImageKit` | unit | PASS |
| 7 | A logged-out visitor can load a review image | `app/api/files/…/route.test.ts:serves a review image to a visitor who is not logged in` | integration | PASS |
| 8 | A logged-out visitor can load a COA | `…:serves a COA to a visitor who is not logged in` | integration | PASS |
| 9 | Bytes are read through the storage driver, not local disk | `…:reads through the storage driver` | integration | PASS |
| 10 | A proof is refused without a session, and served with one | `…:refuses a payment proof…`, `…:serves that same proof once there is a session` | integration | PASS |
| 11 | An unpublished bucket is refused | `…:refuses a bucket nobody published` | integration | PASS |
| 12 | A storage miss answers 404, not a 500 | `…:answers 404 rather than failing` | integration | PASS |
| 13 | Traversal is refused even on a public bucket | `…:refuses a traversal attempt even on a public bucket` | integration | PASS |
| 14 | The COA download redirects to this site | `app/api/coa/…/route.test.ts:keeps the customer on this site` | integration | PASS |
| 15 | A missing COA still says so plainly | `…:still says so plainly when a batch has no COA yet` | integration | PASS |

## Coverage

```
File                                | % Stmts | % Branch | % Funcs | % Lines
lib/file-url.ts                     |     100 |      100 |     100 |     100
lib/feedback.ts                     |     100 |      100 |     100 |     100
app/api/files/[bucket]/[...key]/route.ts |  100 |    81.81 |     100 |     100
```

## Known gaps

- **Payment QR and MOQ product images still resolve to ImageKit.**
  `lib/payment-methods.ts:22` and `lib/moq-products.ts:33` still call
  `signedUrl`. Out of scope — the ask named the COA and the reviews — but they
  are the same class, and the fix is now one function call each.
- **No browser pass.** The proxy has not been exercised against real ImageKit;
  `readFile()`'s non-local branch is covered by a mock, not by a live fetch.
  Worth one real load after deploy, since it is the branch production actually
  runs.
- **The COA gallery page itself does not exist yet.** This makes the existing
  COA download stay on-site; the planned admin upload and `/coa` page are
  unbuilt and still awaiting a decision on grouping.
- **No migration.**

## Merge evidence

```
(RED)   test: require reviews and COAs to be served from bbgph.org
(RED)   test: require the file route to serve public galleries without a login
(RED)   test: require the COA download to keep the customer on this site
(GREEN) feat: serve reviews and COAs from bbgph.org instead of the storage host
```
