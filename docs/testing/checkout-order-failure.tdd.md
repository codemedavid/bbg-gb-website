# TDD Evidence — Checkout order-placement failure

**Reported symptom:** Clicking **Place order** loads, then falls back to "Place order";
`POST /api/orders` returns **503**, and the console shows **React error #418**.

## Source plan

No `*.plan.md`. Journeys derived during this TDD run from the bug report.

## Root causes (diagnosis)

1. **503 on order placement — deployment config, not a code bug.** The only 503 in
   the codebase is `lib/storage.ts:61`: when `STORAGE_DRIVER=imagekit` but
   `IMAGEKIT_PRIVATE_KEY` / `IMAGEKIT_URL_ENDPOINT` are missing in the deploy env,
   `putFile` throws `ApiError(503, …)` (the "fail loudly" behavior from `c4ba164`).
   The proof upload runs before the DB write, so the order never gets created.
   **Operational fix:** set the ImageKit vars in Vercel (Production + Preview) and
   redeploy. Confirm with `vercel env ls`.
2. **React #418 — hydration mismatch (code bug, fixed here).** The cart store
   (`lib/store/cart.ts`) persisted to `localStorage` without `skipHydration`, so
   the client rehydrated the cart before the first render while the server rendered
   an empty cart. The `CartButton` badge / `OrderSummary` totals differed between
   server and client HTML → #418.
3. **Customer-facing error quality (code bug, fixed here).** Checkout surfaced the
   raw 503 string (`STORAGE_DRIVER` / `IMAGEKIT_*`) to buyers.

## User journeys

- As a returning shopper, when the page loads my saved cart, I do not want a
  hydration error, so the storefront renders cleanly.
- As a buyer, when payment uploads are temporarily unavailable, I want a clear,
  retryable message — not deploy configuration jargon.

## Task report

| Behavior | Validation command | RED → GREEN | Guaranteed by passing tests |
|----------|--------------------|-------------|-----------------------------|
| Cart persistence is SSR-safe (defers hydration, restores after mount) | `npx vitest run lib/store/cart-hydration.test.tsx` | RED: `useHydrateCart` module missing (compile-time) → GREEN | Store starts empty on first render (matches SSR); saved cart is restored after the mount-time hook runs |
| Upload-config 503 shown as a friendly, retryable message | `npx vitest run lib/checkout-error.test.ts app/checkout/page.test.tsx` | RED: `checkout-error` module missing + page showed raw jargon → GREEN | Customer never sees `STORAGE_DRIVER`/`IMAGEKIT_*`; stock/validation errors still pass through; cart is not discarded on failure |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Cart store defers persist hydration (`skipHydration: true`) so SSR and first client render match | `lib/store/cart-hydration.test.tsx` | unit | PASS |
| 2 | Saved cart is restored only after `useHydrateCart()` mounts | `lib/store/cart-hydration.test.tsx` | integration | PASS |
| 3 | 503 upload-config error is replaced with a retryable message (no deploy jargon) | `lib/checkout-error.test.ts` | unit | PASS |
| 4 | Stock/validation (400) messages pass through unchanged | `lib/checkout-error.test.ts` | unit | PASS |
| 5 | Empty server message falls back to a generic line | `lib/checkout-error.test.ts` | unit | PASS |
| 6 | Checkout wires the friendly message and keeps the cart on failure | `app/checkout/page.test.tsx` | integration | PASS |

## Coverage & known gaps

- Full suite: **555 passed / 62 files** (`npx vitest run`). `tsc --noEmit` clean.
- New logic (`friendlyCheckoutError` — all 3 branches; `useHydrateCart` — effect path;
  cart `skipHydration` — via `getOptions`) is fully exercised.
- **Known gap (not a code fix):** the 503 itself is resolved by setting the ImageKit
  env vars in the deployment. The `#418` fix removes the hydration error but does not
  and cannot supply the missing secrets — that step is operational.
- JSDOM cannot reproduce a true SSR hydration diff; tests assert the *mechanism*
  (deferred hydration + post-mount restore) that prevents #418.

## Merge evidence

RED commit `88c4bcc` (reproducers) → GREEN commit `ddac609` (fixes). If squashed,
this report preserves the RED→GREEN record.
