# Kahati downpayment QR — TDD record

Source plan: none. The journey came from the request "upload this QR as the
kahati DP QR … the rest, when the kahati is complete, uses the default payment
method QR" (2026-08-24), against a MariBank/InstaPay code locked to **₱150.00**.

## User journeys

1. As an admin, I want to point the hatian downpayment at a real bank QR, so a
   customer joining a kit can pay the deposit by scanning it.
2. As an admin, I want the quoted downpayment to equal the amount the QR is
   locked to, so nobody is asked for a figure their banking app will refuse.
3. As an admin, I want to re-point that QR when the bank reissues it, without
   ending up with two downpayment QRs side by side at checkout.
4. As a customer settling a completed kahati, I want the ordinary payment QR,
   because the balance is not the deposit amount.

## Task report

**Install the downpayment QR and its amount as one operation.**
`lib/kahati-downpayment-qr.ts` uploads the image through the configured storage
driver, upserts the payment method on `(label, purpose='kahati_downpayment')`,
and sets the downpayment policy to `fixed` at the encoded amount — carrying the
existing `refundable` flag and `policyNote` through untouched.

- RED — `npx vitest run lib/kahati-downpayment-qr.test.ts`

  ```
  FAIL  lib/kahati-downpayment-qr.test.ts
  Error: Failed to load url ./kahati-downpayment-qr … Does the file exist?
  Test Files  1 failed (1)
  ```

  Compile-time RED: the test newly references the module that does not exist.

- GREEN — same command

  ```
  ✓ lib/kahati-downpayment-qr.test.ts (5 tests) 2003ms
  Test Files  1 passed (1)   Tests  5 passed (5)
  ```

**Refactor — `ApiError` out of `lib/session`.** `lib/storage` threw `ApiError`,
which lives in `lib/session`, which opens with `import 'server-only'`. That
package is not installed (Next resolves it internally), so any `tsx` script
reaching storage died with `ERR_MODULE_NOT_FOUND`. The class moved to
`lib/api-error.ts`; `lib/session` re-exports it, so every existing
`from '@/lib/session'` import is unchanged.

**Runner.** `scripts/set-kahati-downpayment-qr.ts`, exercised against a
throwaway PGlite:

```
$ npx tsx scripts/set-kahati-downpayment-qr.ts <image> --amount 150
Kahati downpayment QR installed.
  method   dae338e3-30f3-4b47-a8a8-3dc33d05da17
  qr key   a6649631-7b29-4e80-8925-e2bdff2d56a6.png
  collects ₱150 per kahati order
```

A second run returned the **same** `method` id with a new `qr key` — the
idempotency journey, confirmed outside the test as well as inside it.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | The image reaches storage and the row is an active downpayment method carrying its key | `lib/kahati-downpayment-qr.test.ts:stores the image and marks the method as a downpayment method` | integration | PASS |
| 2 | Checkout quotes exactly the peso figure the QR is locked to | `lib/kahati-downpayment-qr.test.ts:quotes exactly the amount the QR is locked to` | integration | PASS |
| 3 | Re-pointing the QR does not reset the refund promise or the admin's wording | `lib/kahati-downpayment-qr.test.ts:keeps the admin's own refund wording when the QR is re-pointed` | integration | PASS |
| 4 | A second run replaces the same method rather than stacking a second QR | `lib/kahati-downpayment-qr.test.ts:replaces the same method on a second run instead of stacking a second QR` | integration | PASS |
| 5 | Full-payment methods are untouched, so the balance still settles against the default QR | `lib/kahati-downpayment-qr.test.ts:leaves full-payment methods alone…` | integration | PASS |

Journey 4 needed no new test: `app/(storefront)/settle/page.tsx` already filters
`m.purpose !== 'kahati_downpayment'` before rendering the picker, and
`app/api/admin/payment-methods/purpose.test.ts` covers that separation end to end.

## Coverage and known gaps

- `scripts/**` is excluded from coverage by `vitest.config.ts`; the runner is a
  thin argument parser over the tested library function, deliberately.
- **Not done: the real image was never installed.** The QR arrived as a chat
  attachment cached at `~/.claude/image-cache/…/1.png`; that cache was cleared
  before it could be copied into the repo, and the bytes are unrecoverable — a
  regenerated QR would encode nothing. `data/payment-qr/` is therefore empty and
  no downpayment method exists in any database yet. Re-supply the file and run
  the command above.
- The ₱150 figure is taken from the amount printed on the QR. Nothing decodes
  the EMVCo payload to verify it; `--amount` is trusted.
