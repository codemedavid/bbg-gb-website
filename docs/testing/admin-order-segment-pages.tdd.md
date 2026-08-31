# TDD evidence — separate admin order pages per segment

**Source plan**: journeys written during this `/ecc:tdd-workflow` run (no `*.plan.md` artifact).
**Branch**: `feat/group-buy-page`
**Asked for**: "i want you to have seperate pages inside the orders like onhand
orders, kahati orders, groupbuy orders".

## Why

`/admin/orders` held every order in one table — on-hand sales, hatian
commitments and campaign/MOQ pre-orders — and the only way to tell them apart
was to read the order-number prefix (`BBG-` / `KH-` / `GB-`). They are three
different jobs asking three different questions: on-hand asks "what left the
shelf", kahati asks "who still owes a balance", group buy asks "what do we order
from the supplier". `lib/report/segment.ts` already draws exactly this line for
the weekly report; the orders board now draws it too, from the same mapping.

Each segment is a route rather than another pill on the status filter row: these
are separate jobs, often done by separate people, and only a URL can be
bookmarked or handed to someone else.

## User journeys

1. As an admin, I want an On-Hand orders page, so stockroom fulfilment is not
   interleaved with orders that are still waiting on the supplier.
2. As an admin, I want a Kahati orders page, so checking downpayments has its own
   list.
3. As an admin, I want a Group Buy orders page holding campaign and MOQ
   pre-orders, since both are ordered from the supplier together.
4. As an admin, I want to move between All / On-Hand / Group Buy / Kahati by
   links I can bookmark, with the open board marked as the current page.
5. As an admin, I want the status filters, the weekly-report toolbar and the
   order sheet to keep working on every one of those pages.

## Task report

### Task 1 — Segment mapping shared with the weekly report (`lib/report/segment.ts`)

`SEGMENT_BUY_TYPES` now names the `orders.buy_type` values behind each segment,
and the pre-existing `GROUP_BUY_TYPES` set is derived from it, so the report and
the orders board cannot disagree about where an MOQ order belongs.
`isReportSegment` narrows an untrusted query param.

- Command: `npx vitest run lib/report/`
- Result: unchanged — no report test was edited; the refactor is covered by the
  existing `lib/report/segment.test.ts` suite.

### Task 2 — Server-side segment filter (`GET /api/admin/orders?segment=`)

Filtered in SQL, not in the browser: the list is unpaginated and returns every
order ever placed, so a client-side split would ship the whole table down the
wire to discard three quarters of it. An unknown segment is a 400 rather than an
ignored param — an admin reading "On-Hand Orders" off the heading while the table
quietly holds everything is worse than an error.

- Command: `npx vitest run app/api/admin/orders/`
- RED: `Tests 4 failed | 2 passed (6)` — `expected [ 'BBG-9001', 'GB-9003', 'KH-9002', 'MQ-9004' ] to deeply equal [ 'BBG-9001' ]`
  for each of the three segments, and `expected 200 to be 400` for the typo case.
  The 2 passing are the no-segment control, and the `segment=groupbuy&status=`
  case — which passed only because the ignored `segment` left the `status`
  filter alone, and that status happened to isolate the same single row.
- GREEN: `Test Files 9 passed (9)` / `Tests 66 passed (66)` — the 6 new segment
  tests plus the 60 pre-existing admin-orders route tests.

### Task 3 — Four boards (`app/admin/orders/*`)

`page.tsx` (442 lines) was split: `OrderDetail.tsx` keeps the order sheet, its
item editor, the proof cards and the reconciliation line; `OrdersBoard.tsx` is
the list, the status pills and the new segment tab bar, scoped by an optional
`segment` prop; `page.tsx` and the three new segment pages are thin wrappers.

The active tab arrives as a prop rather than being read back off `usePathname` —
the page that rendered the board already knows which one it is, and the four
existing component tests do not have to mock `next/navigation` to keep passing.

The tab bar is underlined, not a second row of pills: the status row below it is
a filter *on* the open board, and two identical pill rows would read as one
ten-way filter set.

| Route | Board |
|-------|-------|
| `/admin/orders` | All orders (unchanged; the sidebar still points here) |
| `/admin/orders/on-hand` | `buy_type = 'solo'` |
| `/admin/orders/group-buy` | `buy_type IN ('group_buy','moq')` |
| `/admin/orders/kahati` | `buy_type = 'kahati'` |

- Command: `npx vitest run app/admin/orders/`
- RED: `Error: Failed to resolve import "./on-hand/page" … Does the file exist?` — 0 tests collected
- GREEN: `Test Files 6 passed (6)` / `Tests 42 passed (42)` — the 8 new
  segment-page tests plus the 34 pre-existing order-sheet tests, none edited.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | With no `segment`, the admin list still returns every order | `app/api/admin/orders/segment.test.ts:returns every order when no segment is asked for` | integration | PASS | `npx vitest run app/api/admin/orders/` |
| 2 | `?segment=onhand` returns only `solo` orders | `app/api/admin/orders/segment.test.ts:returns only on-hand orders for segment=onhand` | integration | PASS | same |
| 3 | `?segment=kahati` returns only hatian orders | `app/api/admin/orders/segment.test.ts:returns only hatian orders for segment=kahati` | integration | PASS | same |
| 4 | `?segment=groupbuy` returns campaign **and** MOQ orders | `app/api/admin/orders/segment.test.ts:returns campaign and MOQ orders together for segment=groupbuy` | integration | PASS | same |
| 5 | `segment` and `status` combine rather than override | `app/api/admin/orders/segment.test.ts:narrows by status within a segment` | integration | PASS | same |
| 6 | An unknown segment is a 400 naming the param, not a silent unfiltered list | `app/api/admin/orders/segment.test.ts:rejects an unknown segment` | integration | PASS | same |
| 7 | Each segment page requests only its own segment from the server | `app/admin/orders/segment-pages.test.tsx:asks the server for only the … segment` (×3) | unit | PASS | `npx vitest run app/admin/orders/` |
| 8 | `/admin/orders` still asks for every order | `app/admin/orders/segment-pages.test.tsx:asks for every order on the all-orders page` | unit | PASS | same |
| 9 | The heading names the segment, so the page is not mistaken for all orders | `app/admin/orders/segment-pages.test.tsx:names the segment in the heading …` | unit | PASS | same |
| 10 | All four boards are reachable from any board, at stable URLs | `app/admin/orders/segment-pages.test.tsx:links every segment page from every segment page` | unit | PASS | same |
| 11 | The open board is marked `aria-current="page"` and the others are not | `app/admin/orders/segment-pages.test.tsx:marks the open segment as the current page` | unit | PASS | same |
| 12 | Status filters and the order table survive on a segment page | `app/admin/orders/segment-pages.test.tsx:keeps the status filters and the order table on a segment page` | unit | PASS | same |
| 13 | The order sheet, item editor and proof gallery are unaffected by the file split | `app/admin/orders/{page,add-product,no-proof-reason,proof-gallery}.test.tsx` | unit | PASS | same (34 pre-existing tests, unedited) |

## Coverage and known gaps

- No coverage tool is wired into this repo (`npm test` is `vitest run`, with no
  `test:coverage` script and no `coverage` config block), so no percentage is
  reported here. Every branch added by this change is exercised: four segment
  values including the invalid one, and the four pages.
- **Not covered — the segment split uses `orders.buy_type` only.**
  `segmentOfOrder` in the weekly report additionally falls back to
  `order_items.kind` for rows written before `buy_type` was populated. The list
  endpoint does not join items, so a legacy order with a default `'solo'`
  `buy_type` and hatian lines appears on the On-Hand board. It also appears with
  `solo` in the existing Type column, so it is visible rather than hidden, and
  the weekly report — the thing the batch order is sized from — still classifies
  it correctly.
- **Not covered — no E2E.** The routes are asserted at the component level
  (which board each page asks for, which links it renders) and at the API level;
  no Playwright run drives a browser through the four URLs.
- **Unrelated, pre-existing:** `npx tsc --noEmit` reports three errors in
  `app/admin/products/page.tsx` (`Cannot find name 'ON_HAND_BUNDLE_VIALS'`) from
  a concurrent session's in-flight rename in the uncommitted `lib/pricing.ts`.
  No file touched by this change reports a type error.

## Merge evidence

RED `93d14cd` → GREEN (this commit). If these are squashed, the RED/GREEN
excerpts above are the record.
