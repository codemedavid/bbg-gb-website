# PostHog order events

The app emits one server-side PostHog event per order status change. A PostHog
destination listens for each event name and sends the customer's Gmail — so these
events are part of the product, not just telemetry. A dropped event is a customer
who never hears from us.

Captured in `lib/posthog.ts` via `posthog-node`. Nothing is sent when `POSTHOG_KEY`
is unset (a valid local/dev state — the capture is logged and skipped).

Gmail-safe HTML for each of these events lives in [`email-templates/`](email-templates/README.md) —
paste one per workflow.

## Configuration

```
POSTHOG_KEY=phc_xxxxx                    # project API key; unset = capture skipped
POSTHOG_HOST=https://us.i.posthog.com    # optional, defaults to US cloud (use eu.i.posthog.com for EU)
```

Set these in Vercel → Project Settings → Environment Variables.

## Event names

| Event | Fired when | Where |
|---|---|---|
| `order_placed` | Checkout succeeds (status starts at `proof_review`) | `app/api/orders/route.ts` |
| `order_updated` | The order was edited — carries a revised receipt, status unchanged | `app/api/orders/[id]/route.ts` |
| `order_proof_review` | Admin sets status back to Proof under review | `app/api/admin/orders/[id]/status/route.ts` |
| `order_payment_confirmed` | Admin confirms the payment proof | ” |
| `order_batch_filling` | Admin moves the order to Batch filling | ” |
| `order_shipped` | Admin marks it shipped | ” |
| `order_delivered` | Admin marks it delivered | ” |
| `order_cancelled` | Admin cancels the order | ” |
| `kahati_cancelled` | A hatian expired under 7 vials and the batch was dropped | `lib/kahati-server.ts` |
| `settlement_placed` | The hatian final checkout succeeds — one payment settling every completed hatian | `app/api/settlements/route.ts` |
| `password_reset_requested` | A reset link was requested on `/forgot-password` | `app/api/auth/forgot-password/route.ts` |
| `order_status_changed` | Fallback — only if a status is ever added without a name here | `lib/posthog.ts` |

`order_status_changed` should get **no** workflow. It means a status was added
without a name in `ORDER_STATUS_EVENT`; it needs a developer, not a customer email.

`kahati_cancelled` is deliberately separate from `order_cancelled`: it carries the
refund amount and the hatian that fell through, so the email can explain *why*.

`password_reset_requested` is the one event that carries a **credential**: its
`resetUrl` property is a single-use link that expires in an hour. Its workflow must
send immediately — batching or digesting it delivers a dead link — and must never CC
or BCC an internal address, since a copy of the link is a copy of the account. The
link's host comes from `APP_URL`; without that set, it falls back to the request's
Host header, which an attacker can set.

## Identity

- `distinct_id` is the **customer's** user id — never the admin who made the change.
- `email` is sent both as an event property and via `$set`, so a PostHog destination
  can resolve the recipient from either the event or the person.
- `$set` also carries `name`.

## Properties

Common to every order event:

| Property | Type | Notes |
|---|---|---|
| `email` | string | recipient |
| `orderId` | uuid | |
| `orderNo` | string | e.g. `BBG-2500` — use this in the subject line |
| `status` | string | raw enum value, e.g. `shipped` |
| `totalPhp` | number | |
| `downpaymentPhp` | number | 0 for on-hand orders |
| `buyType` | string | `solo` \| `kahati` |

`order_placed` adds: `subtotalPhp`, `packingFeePhp`, `balancePhp` (total − downpayment,
what a kahati customer still owes), `itemCount`, `paymentMethod`, `items`.

`order_updated` is the one order event with **no** `status` or `downpaymentPhp` — the
edit does not move the order through the flow. It carries `subtotalPhp`,
`packingFeePhp`, `totalPhp`, `editedBy` and `items`.

`items` is `{ name, qty, unitPrice, lineTotal }[]` — what an emailed receipt loops over.

Status-change events add: `statusLabel` (human-readable, e.g. "Payment confirmed"),
`previousStatus`, `trackingNo`, `courier`, `note`.

`kahati_cancelled` adds: `kahatiId`, `kahatiName`, `claimedVials`, `minVials` (7),
`refundPhp` — the downpayment to return.

`settlement_placed` is the one event that is **not** about a single order, so it
carries no `orderId`/`orderNo`/`status`. It adds: `settlementId`, `orderCount`
(how many hatian orders this payment settles), `balancePhp`, `packingFeePhp`
(charged once, not per hatian — say so in the copy), `totalPhp`, `paymentMethod`.

## Behaviour guarantees

- **Never throws.** A PostHog outage cannot fail a checkout or a status update;
  failures are logged and swallowed (`lib/posthog.ts`).
- **Flushes on every capture** (`flushAt: 1`, `flushInterval: 0`). Serverless
  invocations end before a batching client would send.
- **Emitted only after the database work commits** — no event for a rolled-back order.
- **Not emitted when the request is rejected** (e.g. an invalid status → 400).

## Relationship to the app's own email

The app still writes `email_log` rows and, when `SMTP_HOST` is set, sends its own
mail. `SMTP_HOST` is currently unset, so nothing is actually delivered by the app
and PostHog is the real sender — there is no double-send today.

**If you later configure `SMTP_HOST`, customers will get two emails per status**
(one from the app, one from PostHog). At that point either leave SMTP unset or
strip the send path from `lib/email.ts`, keeping `email_log` as the audit trail.
