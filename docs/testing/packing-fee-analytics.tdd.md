# Packing-fee analytics TDD evidence

## Source

No plan file was supplied. The journeys and guarantees below were derived from the request to show total accumulated packing fees and analytics on the admin dashboard.

## User journeys

- As an admin, I want to see accumulated packing fees on the dashboard so that I can understand fee revenue at a glance.
- As an admin, I want weekly and monthly packing-fee context so that I can compare recent performance with the all-time total.
- As an admin, I want deferred Hatian settlement fees counted once so that the analytics are not inflated by linked orders or cancelled charges.

## Task report

### RED — missing API and dashboard behavior

- Added API integration coverage for empty data, time windows, direct order fees, deferred settlement fees, cancelled records, and linked-order deduplication.
- Added a component test for the all-time, weekly, and monthly values visible to an admin.
- Command: `npm test -- app/api/admin/stats/route.test.ts app/admin/page.test.tsx`
- Result: **RED**, 2 files failed and 3 tests failed. The API returned no `packingFees` field and the dashboard had no `Total packing fees` card.
- Checkpoint: `0125318 test: add packing fee analytics RED coverage`

### GREEN — aggregation contract and dashboard card

- Added `packingFeeTotals()` to combine non-cancelled direct order fees with non-cancelled deferred settlement fees across 7-day, 30-day, and all-time windows.
- Active settlement fees take precedence over fees on linked orders, preventing the same parcel from being counted twice.
- Extended the admin stats API type and added a responsive dashboard card.
- Command: `npm test -- app/api/admin/stats/route.test.ts app/admin/page.test.tsx`
- Result: **GREEN**, 2 files passed and 3 tests passed.
- Checkpoint: `f0f9e3e feat: add packing fee dashboard analytics`

### Coverage completion and regression verification

- Added populated-dashboard and loading-state coverage without changing production behavior.
- Feature coverage command: `npm test -- app/api/admin/stats/route.test.ts app/admin/page.test.tsx --coverage --coverage.include=lib/analytics.ts --coverage.include=app/admin/page.tsx --silent`
- Result: **PASS**, 2 files and 5 tests passed; 100% statements, 91.3% branches, 100% functions, and 100% lines across the included feature files.
- Full regression command: `npm test`
- Result: **PASS** (successful exit; no failed test reported).
- TypeScript command: `./node_modules/.bin/tsc --noEmit`
- Result: **PASS**.

## Test specification

| # | What is guaranteed | Test target | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | An empty database returns zero weekly, monthly, and all-time packing fees | `app/api/admin/stats/route.test.ts: returns zero totals` | Integration | PASS | Targeted coverage run |
| 2 | Direct order and deferred settlement fees are combined into the correct time windows | `app/api/admin/stats/route.test.ts: combines order and deferred-settlement fees` | Integration | PASS | Expected `{ week: 350, month: 825, all: 1425 }` |
| 3 | Cancelled records are excluded and a settlement-linked order fee is not counted twice | Same integration test | Integration | PASS | Cancellation and duplicate fixtures are present in the aggregate assertion |
| 4 | The admin sees the all-time fee total with weekly and monthly context | `app/admin/page.test.tsx: shows the accumulated total` | Component | PASS | Visible PHP-formatted values asserted |
| 5 | Packing-fee analytics remain visible with populated charts and lists | `app/admin/page.test.tsx: keeps the analytics visible` | Component | PASS | Populated dashboard path asserted |
| 6 | The dashboard retains a loading state while analytics are fetched | `app/admin/page.test.tsx: shows the dashboard loading state` | Component | PASS | Loading copy asserted |

## Coverage and known gaps

- Feature scope: 100% statements, 91.3% branches, 100% functions, 100% lines.
- `lib/analytics.ts`: 100% statements/lines/functions and 87.5% branches.
- `app/admin/page.tsx`: 100% statements/lines/functions and 93.33% branches.
- No tests are skipped or disabled in the feature targets.
- `npm run lint` could not validate code because the existing `next lint` script opens Next.js's first-time interactive ESLint configuration prompt. Project-wide lint configuration was left unchanged; TypeScript validation passed.

## Merge evidence

- RED: `0125318` — three intended failures proved the API field and UI were absent.
- GREEN: `f0f9e3e` — the same three tests passed after the minimal implementation.
- Coverage completion: five feature tests passed at 100% statement/line/function coverage and 91.3% branch coverage.
