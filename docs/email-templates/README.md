# BBG Peptides — customer email templates

Gmail-safe HTML for every customer-facing order email. **PostHog Workflows is the
sender** (see `docs/posthog-events.md` and the `posthog-email-sender-decision` note) —
these files are meant to be pasted into a PostHog message template's HTML editor, one
per workflow, and they use Liquid variables bound to the trigger event.

They are plain `.html` files, so you can also open them in a browser to check layout
(Liquid tags render as literal text there) or paste one into a Gmail compose window if
you ever need to send an update by hand.

## Links

Every CTA points at **`https://www.bbgph.org`** — the canonical host. The apex
`bbgph.org` answers 308 to `www`, so linking `www` directly saves the redirect hop.
`password-reset.html` is the exception: its link is absolute already, built server-side
from `APP_URL`.

Note that `/orders/<id>` requires a signed-in session and the app has no
`?next=` return path yet — see the last gap below.

## Which file goes on which workflow

| Template | PostHog event | Fired when |
|---|---|---|
| `order-placed.html` | `order_placed` | Checkout succeeds — itemised receipt, status starts at `proof_review` |
| `order-updated.html` | `order_updated` | Order was edited — revised receipt, status unchanged |
| `order-proof-review.html` | `order_proof_review` | Admin sent the order **back** to Payment Pending |
| `order-payment-confirmed.html` | `order_payment_confirmed` | Admin verified the payment proof |
| `order-batch-filling.html` | `order_batch_filling` | Order moved to Processing |
| `order-shipped.html` | `order_shipped` | Marked shipped — shows tracking number + courier |
| `order-delivered.html` | `order_delivered` | Marked delivered — storage reminders |
| `order-cancelled.html` | `order_cancelled` | Admin cancelled a single order |
| `kahati-cancelled.html` | `kahati_cancelled` | Hatian expired under 7 vials — explains the refund |
| `settlement-placed.html` | `settlement_placed` | Hatian final checkout — one payment, one packing fee |
| `settlement-confirmed.html` | ⚠ **no event yet** | See the gap below |
| `password-reset.html` | `password_reset_requested` | Someone asked for a reset link on `/forgot-password` — carries a single-use link that expires in an hour |

`order_status_changed` gets **no** template and **no** workflow. It only fires when a
status was added without a name in `ORDER_STATUS_EVENT`, which needs a developer.

## Suggested subject lines

Each file carries its subject in the top HTML comment. Collected here:

| Template | Subject |
|---|---|
| order-placed | `Order {{ event.properties.orderNo }} received — payment under review` |
| order-updated | `Updated receipt for order {{ event.properties.orderNo }}` |
| order-proof-review | `Order {{ event.properties.orderNo }} — we need another look at your payment` |
| order-payment-confirmed | `Order {{ event.properties.orderNo }} — payment confirmed` |
| order-batch-filling | `Order {{ event.properties.orderNo }} — now processing` |
| order-shipped | `Order {{ event.properties.orderNo }} is on its way` |
| order-delivered | `Order {{ event.properties.orderNo }} delivered — salamat!` |
| order-cancelled | `Order {{ event.properties.orderNo }} has been cancelled` |
| kahati-cancelled | `Order {{ event.properties.orderNo }} cancelled — the hatian did not reach {{ event.properties.minVials }} vials` |
| settlement-placed | `Final payment received — {{ event.properties.orderCount }} hatian order(s) under review` |
| settlement-confirmed | `Final payment confirmed — salamat!` |
| password-reset | `Reset your BBG Peptides password` |

## Liquid notes

- Event data: `{{ event.properties.orderNo }}`. Person data:
  `{{ person.properties.name | default: 'kabahagi' }}`. If PostHog's merge-tag dropdown
  shows a different shape for your project, trust the dropdown and adjust.
- **Single quotes only inside Liquid expressions.** The email builder serialises the
  template to JSON; a double quote inside `{{ ... }}` escapes and breaks the Liquid
  parser with a `TokenizationError` on save.
- Always give optional properties a `default:`. `trackingNo`, `courier` and `note` are
  frequently null and are already wrapped in `{% if %}` here.
- `order-placed.html` and `order-updated.html` loop the receipt:
  `{% for item in event.properties.items %}` with `item.name`, `item.qty`,
  `item.unitPrice`, `item.lineTotal`.

## Gmail constraints these files respect

- Tables for layout, no flexbox or grid — Gmail strips `display:flex`, which collapses
  two-column receipt rows into unaligned stacked text.
- All CSS inline; no `<style>` block, no external stylesheet, no web fonts (Barlow is
  declared but Arial is what actually renders).
- 600px max width with `width:100%` so it reflows on phones.
- No background images, no `<img>` at all — nothing breaks when images are blocked.
- Hidden preheader div as the first element, which is what Gmail shows next to the
  subject in the inbox list.
- `&#8369;` rather than a literal ₱, so encoding cannot mangle the peso sign.

## Copy rules

- **No "reply to this email."** Every footer ends with `Do not reply — hindi
  binabantayan ang inbox na ito.` Nobody reads the PostHog sending address, so inviting
  a reply sends the customer into a black hole. If you add a real support channel
  (Messenger, Viber, a support inbox), put it in the footer and these lines can soften.
- **No promised turnaround.** The copy says *kindly wait for verification*, never "within
  24 hours" — verification is manual and a missed deadline in writing is a complaint.

## Known gaps

1. **`settlement_confirmed` has no event.** `app/api/admin/settlements/[id]/route.ts`
   calls `sendEmail(settlementConfirmedEmail(...))` but never `captureEvent()`. With
   `SMTP_HOST` unset, a customer whose final payment is verified currently hears
   nothing. `settlement-confirmed.html` is ready, but the route needs a
   `settlement_confirmed` capture (`settlementId`, `orderCount`, `totalPhp`) first.
2. **Money renders unformatted.** `totalPhp: 10700` prints as `₱10700`; Liquid has no
   thousands-separator filter. If the client wants `₱10,700`, the cleanest fix is to
   emit preformatted `*Display` strings alongside the numbers in `lib/posthog.ts`.
3. **`lib/email.ts` uses `display:flex` for its receipt rows.** Those templates are
   dormant while `SMTP_HOST` is unset, but if app-side sending is ever turned on, the
   receipts will render misaligned in Gmail. Copy the table markup from
   `order-placed.html` at that point.
4. **The order CTA dead-ends for a logged-out customer.**
   `app/(storefront)/orders/[id]/page.tsx` guards on `isLoading || !data`, so a 401 from
   an expired session renders "Loading…" forever instead of a login prompt. And
   `app/login/page.tsx` always `router.replace('/')`, so even logging in manually loses
   the deep link. Until both are fixed, these buttons only work for a customer already
   signed in on that browser.
