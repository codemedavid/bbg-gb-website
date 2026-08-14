# Group Buy Product Totals E2E Report

**Date:** 2026-08-15 (Asia/Manila)  
**Status:** PASSING  
**Final result:** 61 passed, 0 failed, 0 skipped

## Summary

The Group Buy reporting flow is doing the right thing end to end. A real Next.js server was started against an isolated PGlite database, an admin opened the shared schedule and created campaigns, a customer placed repeated Group Buy orders, and the admin report API returned those live orders and their product rollup.

The API payload was then passed through the production XLSX builder, serialized, and reopened with ExcelJS. The generated file contained exactly one `BBG-ProductTotals` worksheet, included the Batch 6 summary row, and carried TOTAL values identical to the live report payload.

Observed report summary in the final run:

- 8 Group Buy orders
- 6 canonical catalog products
- 270 supplier units
- $0 total USD because the six seeded Group Buy products have no catalog USD price
- Workbook summary: `# Orders: 8  Units: 270`
- Every exported Product, Variant / Code, and Specs cell matched the catalog;
  no Kahati, Group Buy, or Batch labels leaked into the product rows

The admin report page also retains its fuller on-screen summaries: Order Summary plus Product Totals tiles/table.

## Environment

- Next.js development server: `http://localhost:3177`
- Database: isolated PGlite under a temporary directory
- Migrations applied: 23
- Seed data: 101 products, 2 users, payment methods, and sample data
- External email and PostHog delivery disabled
- Production/Supabase data was not accessed or changed

## Critical guarantees

| # | Guarantee | Result |
|---|---|---|
| 1 | Admin authentication works over real HTTP | PASS |
| 2 | QA opens a deterministic Group Buy/Hatian trading window | PASS |
| 3 | Campaign creation uses only Group Buy-enabled products | PASS |
| 4 | Customer campaign ordering and idempotent replay work | PASS |
| 5 | Only one packing fee is charged across the trading cycle | PASS |
| 6 | Admin participants and report endpoints contain the placed orders | PASS |
| 7 | Report API includes order count, product rows, unit total, and USD total | PASS |
| 8 | XLSX serializes and reopens successfully | PASS |
| 9 | XLSX has one `BBG-ProductTotals` worksheet | PASS |
| 10 | XLSX row 2 contains the order/unit summary | PASS |
| 11 | XLSX TOTAL units and USD match the live API summary | PASS |
| 12 | Product, Group Buy, Hatian, MOQ, payment, settings, analytics, report, settlement, and category endpoints remain healthy | PASS |
| 13 | Product rows contain canonical catalog names, codes, and specs with no channel/batch labels | PASS |
| 14 | Reopened XLSX product rows exactly match the report's canonical product rows | PASS |

## Harness corrections found during testing

The first runs exposed three stale assumptions in `scripts/qa/e2e-groupbuy.ts`; these were QA defects, not production report defects:

1. The script tried to create a campaign with all products after independent sales-channel enforcement was introduced. It now selects only `isGroupBuy` products.
2. The script assumed seed data left the trading window open. It now configures a deterministic active window inside the isolated QA database.
3. The script expected a second campaign in the same cycle to charge another packing fee. Current behavior intentionally charges one shared cycle fee, matching the existing checkout tests.

## Commands and evidence

```text
env DATABASE_URL= PGLITE_PATH=<temporary>/db ... npx tsx scripts/qa/bootstrap.ts
Applying 23 migration files ... all ok

env DATABASE_URL= PGLITE_PATH=<temporary>/db ... npx tsx scripts/seed.ts
Seed complete.

env ... PORT=3177 npm run dev
Ready

env QA_BASE_URL=http://localhost:3177 ... npx tsx scripts/qa/e2e-groupbuy.ts
E2E RESULT: 61/61 passed, 0 failed
```

## Scope note

This run exercised the real HTTP/API, persistence, authentication, aggregation, XLSX serialization, and XLSX readback path. The existing browser-download integration tests separately cover anchor creation, filename selection, click behavior, and object-URL cleanup. No desktop Excel GUI was automated.
