# TDD Evidence — Client Change Request (2026-07-21)

**Branch:** `feat/client-changes-jul21`
**Source plan:** inline `/ecc:plan` output (this session), confirmed by the user.

## User journeys

1. As a customer, after I place an order my cart is emptied.
2. As a customer, when I commit on the Kahati page I go straight to the payment page.
3. As an admin, when a payment-method save fails I see the reason in the form.
4. As an admin, I can open a Reports section from the admin nav.
5. As an admin, I can read an Order Summary (detail + rollups) and export the weekly Excel.
6. As the team, the report "Admin" handler names are Cza / Ruth / Richme.
7. As a customer, I can choose J&T or Lalamove shipping at checkout, saved on the order.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Cart empties after a successful order (single + multi) | `app/checkout/page.test.tsx:empties the cart once the order is placed` | component | PASS |
| 2 | Kahati commit adds to cart **and** pushes `/checkout` | `components/JoinSheet.test.tsx` | component | PASS |
| 3 | Rejected payment-method save shows its reason inline (`role="alert"`) | `app/admin/payment-methods/page.test.tsx` | component | PASS |
| 4 | Reports page renders heading + fetched Order Summary + Excel button | `app/admin/reports/page.test.tsx` | component | PASS |
| 5 | Order Summary renders rollup tiles + a detail row per order; empty state | `app/admin/reports/OrderSummaryReport.test.tsx` | component | PASS |
| 6 | Handler names = Cza/Ruth/Richme; couriers include J&T + Lalamove | `lib/report/constants.test.ts` | unit | PASS |
| 7 | Checkout offers only J&T/Lalamove and sends `courier`; order persists it; invalid courier rejected; defaults to J&T | `app/checkout/page.test.tsx`, `app/api/orders/route.test.ts` | component + integration | PASS |

## RED → GREEN evidence

- RED (F2/F6/F7 backend): `vitest run lib/report/constants.test.ts components/JoinSheet.test.tsx app/api/orders/route.test.ts` → **6 failed | 31 passed** (missing-feature failures only).
- GREEN (same command after impl): **37 passed**.
- RED (F3): file-input timing failure → rewritten with `findBy`; GREEN after `try/catch` added to `MethodForm.submit`.
- RED (F5): `getByText('Paid')` matched tile+row → narrowed to unique labels; GREEN.
- Full suite: `vitest run` → **59 files, 540 passed**.
- Typecheck: `tsc --noEmit` → exit 0.
- Build: `next build` → Compiled successfully; `/admin/reports` = 4.3 kB (ExcelJS stays dynamically imported).

## Known gaps / follow-ups

- **Feature 3 production fix is environment config, not code.** Locally the storage driver falls back to the filesystem, so QR uploads succeed and the failure is not reproducible here. For the live site, set in Vercel: `STORAGE_DRIVER=supabase` + `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (or the ImageKit trio). Until then `putFile` returns a clear 503, now shown inline in the form.
- **Feature 6** replaces the report **handler** names (the "Admin" dropdown / report column), per the user's screenshot — no login accounts were created, matching the clarified request.
- Order Summary period = the selected Mon–Sun week (reuses the weekly pipeline). A custom date range was not requested.
