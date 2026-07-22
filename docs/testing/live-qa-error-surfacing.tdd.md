# Live QA — error surfacing fixes (admin mutations + stale-cart checkout)

**Source plan:** none — defects found during a live browser QA pass (Chrome DevTools
against `next dev` + seeded local PGlite) run after the hatian QA fixes
(`docs/testing/hatian-qa-fixes.tdd.md`) landed. Journeys were derived during this run.

## How the bugs were found

1. **Admin over-cap edit, live:** editing Bioglutide's claimed vials to 15 (cap 10).
   The server correctly answered 400 (`hatian-qa-fixes` B7 guard) — but the admin UI
   showed **nothing**: uncaught promise rejection, modal left open, no message. The same
   swallow existed in the product form, the order status sheet, and every `useMutate`
   mutation without an `onError` toast — including `deleteGroupBuy`, whose new
   409 "cancel it instead" explanation could never reach the admin.
2. **Customer checkout 400 loop, live:** the user hit six identical
   `POST /api/orders` 400s. Cause: the cart persists in localStorage, so a line whose
   listing no longer exists (here: a hatian id from a reseeded dev DB; in production: a
   delisted product or a deleted/closed hatian) fails checkout identically on every
   retry. The page showed the raw server message — UUID included — in a 2.2s toast and
   kept the dead line.

## User journeys

* As an admin, when a save/close/delete/status change is refused by the server, I want
  to see the reason where I acted, so I can correct the input instead of concluding the
  button is broken.
* As a customer whose cart holds a line the shop can no longer sell, I want checkout to
  remove that line and tell me plainly, so I can complete the rest of my order instead
  of failing forever.

## Task report

### 1. Admin mutations surface server rejections

* **RED** (`7d51f9d`): 8 failing tests across 4 new files — pages: "Unable to find
  role=alert"; hook: `expected '' to match /cancel the hatian instead/i`.
* **Fix** (`7c887a3`): `GroupBuyForm`, `ProductForm` and the order status sheet catch a
  rejected `mutateAsync` and render the reason inline (`role="alert"`, modal stays
  open) — the pattern the payment-methods form set in `11906c4`. `useMutate` adds the
  missing `onError` toasts: `saveGroupBuy`, `deleteGroupBuy`, `setOrderStatus`,
  `saveProduct`, `archiveProduct`.
* **GREEN:** `npx vitest run app/admin lib/admin-api.errors.test.tsx` → 9 files,
  45/45 passing.

### 2. Checkout drops a dead cart line instead of looping its 400

* **RED** (`2bdbfae`): 7 failing tests — `staleCheckoutLine` did not exist; the page
  kept the dead line and echoed the raw id.
* **Fix** (`93330dd`): `staleCheckoutLine()` in `lib/checkout-error.ts` recognizes the
  four never-heals rejections (`Product not available: <id>`,
  `MOQ product not available: <id>`, `Group buy not found: <id>`,
  `Kahati "<name>" is/has already closed…`). The checkout page removes that one line,
  keeps the rest of the cart, and toasts
  `"<line name>" is no longer available and was removed from your cart.`
  Quantity/stock shortfalls deliberately pass through unchanged — the customer can fix
  those by editing quantity.
* **GREEN:** `npx vitest run lib/checkout-error.test.ts app/checkout/page.test.tsx` →
  18/18 passing.
* **Live re-verification:** seeded a stale hatian line + valid on-hand line in
  localStorage, submitted checkout → dead line removed, valid line kept; the immediate
  retry placed order `BBG-2484`.

## Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|--------------------|-----------|------|--------|
| 1 | A rejected group-buy save shows its reason inline; the modal stays open | `app/admin/groupbuys/page.test.tsx` | component | PASS |
| 2 | A successful group-buy save still closes the modal | `app/admin/groupbuys/page.test.tsx` | component | PASS |
| 3 | A rejected product save shows its reason inline | `app/admin/products/page.test.tsx` | component | PASS |
| 4 | A rejected order status update shows its reason in the sheet; success closes it | `app/admin/orders/page.test.tsx` | component | PASS |
| 5 | saveGroupBuy / deleteGroupBuy / setOrderStatus / saveProduct / archiveProduct toast the server reason on rejection | `lib/admin-api.errors.test.tsx` | hook | PASS |
| 6 | `staleCheckoutLine` extracts the refId from product / MOQ / group-buy unavailable rejections | `lib/checkout-error.test.ts` | unit | PASS |
| 7 | `staleCheckoutLine` matches a closed hatian by name; recoverable rejections return null | `lib/checkout-error.test.ts` | unit | PASS |
| 8 | Checkout removes the dead line (by refId or kahati name), keeps the rest, and shows no raw ids | `app/checkout/page.test.tsx` | component | PASS |

## Verification

* Full suite: `npx vitest run` → **71 files, 611/611 passing** (baseline before this
  session's additions: 67 files / 594).
* `npx tsc --noEmit` → clean.
* Coverage (`npx vitest run --coverage`): overall **58.45% statements / 81.46%
  branches** — the statement gap is pre-existing untested UI pages (admin dashboards,
  storefront boards); every line changed in this session is exercised by the new tests.

## Test-authoring note (for future reproducers)

`beforeEach(() => mock.mockReset())` registers the mock as a vitest **cleanup hook** —
`mockReset()` returns the mock (chainable), and a function returned from `beforeEach`
is treated as teardown, which re-invokes the still-rejecting mock and fails the test
with an unhandled rejection. Always use a braced body:
`beforeEach(() => { mock.mockReset(); })`.

## Known gaps / deferred

* Dev-only observation: `BBG-####` order numbers can jump by up to 32 after an unclean
  PGlite reopen (Postgres WAL pre-logs sequence values). Uniqueness — the real
  invariant — holds; not fixed, cosmetic and dev-only.
* Admin orders week selector defaults to the last *complete* week (today's week absent
  from the dropdown). Matches weekly-report semantics; flagged for the client to
  confirm, not changed.
* `/moq` returning 404 is by design — the page sits behind the admin visibility toggle
  (`getMoqPageEnabled`), off in the seed.
