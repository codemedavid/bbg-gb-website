# Search boxes — hatian board and products catalog

**Source plan:** none. Journeys were derived during this TDD run from the request
"can you add search bar also there" (the hatian board) followed by "kahati at sa
products also".

**Branch:** `feat/group-buy-page`

| Checkpoint | Stage |
|---|---|
| `cb5bbd3` | RED — hatian board search |
| `6727c3c` | GREEN — hatian board search |
| (RED products) | RED — products catalog search |
| (GREEN products) | GREEN — products catalog search |
| (refactor) | shared `searchInput` token across all three admin search boxes |

Context: the hatian board is the page the sidebar labels **Hatian** and the
heading calls **Group Buys** (`/admin/groupbuys`) — the kahati board. It gained
its search box in the first pair of checkpoints, so "kahati" was already covered
when products was requested.

## User journeys

1. As an admin, I want to search the hatian board by name, so that I can find one
   counter among the siblings every cycle adds.
2. As an admin, I want to search the products catalog by name **or code**, so
   that I can reach one product in a hundred-odd unpaginated rows — the supplier
   price list identifies a product by code, not by the name the catalog uses.
3. As an admin, I want to be told when nothing matches, and to see what I
   searched for, so that I can tell a typo from an empty board.
4. As an admin, I want the counts on screen to stay honest while filtered, so
   that a search never silently rewrites how big the board or catalog is.
5. As an admin, I want the cycle control to keep acting on — and reporting — the
   **whole** board, so that searching one name cannot mislead me about how many
   counters "Start new cycle" will end.

## Task report

### 1. Hatian board search (`app/admin/groupbuys/page.tsx`)

Client-side filter on name. The admin feed already returns the whole board, so a
round trip would buy nothing and no debounce is needed.

- Command: `npx vitest run app/admin/groupbuys/page.test.tsx`
- RED: 5 failed | 28 passed (33) — no search box on the board
- GREEN: 33 passed (33)

The `running` count that feeds the cycle control is deliberately derived from the
whole board, never from the filtered view. Mutation-checked: pointing `running`
at the filtered list fails exactly one test (`1 failed | 32 passed`), so the
assertion genuinely discriminates.

One test assertion was tightened during GREEN: `findByText(/3 counters/i)` matched
both the dialog title and the new "1 of 3 counters" hint, so it was scoped to
`findByRole('heading', …)`.

### 2. Products catalog search (`app/admin/products/page.tsx`)

Client-side filter on name **or** code, with `(p.code ?? '')` so a product
without a code cannot throw.

- Command: `npx vitest run app/admin/products/page.test.tsx`
- RED: 6 failed — no search box on the products table
- GREEN: 24 passed (24)

The subtitle already carried the catalog count ("101 items."), so the filtered
figure goes there — "1 of 101 items." — rather than in a second hint.

### 3. Refactor

Products, hatian and accounts each carried the same input class string inline.
Extracted as `searchInput` in `components/admin-ui.tsx`; accounts keeps its
`ml-auto` via a template string.

- Command: `npx vitest run app/admin components`
- Result: 459 passed (459) across 48 files

## Test specification

| # | What is guaranteed | Test file or command | Type | Result |
|---|--------------------|----------------------|------|--------|
| 1 | Only counters whose name matches are shown | `app/admin/groupbuys/page.test.tsx:shows only the counters whose name matches` | unit (RTL) | PASS |
| 2 | Matching is case-insensitive and partial | `…groupbuys/page.test.tsx:matches case-insensitively and on part of the name` | unit (RTL) | PASS |
| 3 | A no-match board names what was searched for | `…groupbuys/page.test.tsx:says so when nothing matches…` | unit (RTL) | PASS |
| 4 | Clearing the search restores the whole board | `…groupbuys/page.test.tsx:brings the whole board back when the search is cleared` | unit (RTL) | PASS |
| 5 | The cycle control counts the whole board, not the filtered view | `…groupbuys/page.test.tsx:keeps the cycle control counting the whole board…` | unit (RTL) | PASS |
| 6 | The search box is absent on an empty board | `…groupbuys/page.test.tsx:hides the search box when the board is empty` | unit (RTL) | PASS |
| 7 | Only products whose name matches are shown | `app/admin/products/page.test.tsx:shows only the products whose name matches` | unit (RTL) | PASS |
| 8 | A product is reachable by its supplier code | `…products/page.test.tsx:finds a product by its code` | unit (RTL) | PASS |
| 9 | A product with a null code does not break the filter | `…products/page.test.tsx:does not fall over on a product with no code` | unit (RTL) | PASS |
| 10 | A no-match table names what was searched for | `…products/page.test.tsx:says so when nothing matches…` | unit (RTL) | PASS |
| 11 | The subtitle reports filtered count against the whole catalog | `…products/page.test.tsx:reports the filtered count against the whole catalog` | unit (RTL) | PASS |
| 12 | Clearing the search restores the whole catalog | `…products/page.test.tsx:brings the whole catalog back when the search is cleared` | unit (RTL) | PASS |
| 13 | The search box is absent on an empty catalog | `…products/page.test.tsx:hides the search box when the catalog is empty` | unit (RTL) | PASS |

## Coverage and verification

- `npx vitest run app/admin components` → **459 passed (459)**, 48 files.
- `npx tsc --noEmit` → clean.

## Live QA

Local dev server on PGlite, seeded, signed in as admin.

- **Hatian board** (11 counters after a cycle): typing `tirze` narrows to
  **4 of 11 counters**, showing both Tirzepatide names in their open and closed
  states. The count hint appears beside the box only while filtered.
- **Products catalog** (101 rows): typing `CU100` narrows to **1 of 101 items** —
  GHK-Cu 100mg vial — proving code search reaches a product whose name does not
  contain the query at all.

## Known gaps and flagged decisions

- **No debounce.** Both filters run on the in-memory list the feed already
  returned, so there is no request to debounce. The accounts screen keeps its
  debounce because its search is a server query.
- **Products search covers name and code, not spec.** The row also displays the
  spec ("20mg vial"), so searching `20mg` will not match. Adding spec would make
  a query like `10mg` match dozens of rows, which is why it was left out — say so
  if you would rather have it.
- **Hatian search is name-only.** Counters have no code. Status is not
  searchable; the cards already carry a visible status badge and the board is
  short enough to scan once filtered by name.
- No E2E test was added; the live QA above covers the same paths manually.
