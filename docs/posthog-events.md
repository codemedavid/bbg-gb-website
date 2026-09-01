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
| `password_reset_requested` | A reset link was requested on `/forgot-password` — **needs a workflow**, see below | `app/api/auth/forgot-password/route.ts` |
| `order_status_changed` | Fallback — only if a status is ever added without a name here | `lib/posthog.ts` |

`order_status_changed` should get **no** workflow. It means a status was added
without a name in `ORDER_STATUS_EVENT`; it needs a developer, not a customer email.

`kahati_cancelled` is deliberately separate from `order_cancelled`: it carries the
refund amount and the hatian that fell through, so the email can explain *why*.

### `password_reset_requested` — the one workflow with special rules

This event carries a **credential**: its `resetUrl` property is single-use and
expires in an hour. PostHog delivers it like every other customer email (the
operator's decision on 2026-09-02), but its workflow must be configured
differently from the marketing-shaped ones, because the default settings broke it
once already.

**The workflow MUST be set to:**

| Setting | Required value | Why |
|---|---|---|
| Re-entry | **Allow unlimited re-entry** | A customer who forgets their password twice must get two emails. This is the setting that failed. |
| Unsubscribe / opt-out suppression | **Ignore** | Account recovery is transactional, not marketing. A customer who opted out of order updates must still be able to get back into their account. |
| Trigger | event `password_reset_requested` | |
| Link in template | `{{ event.properties.resetUrl }}` | Without this the mail contains no link and the whole flow is pointless. |

Between 2026-08-17 and 2026-08-31 those settings were wrong and it cost two weeks
of broken account recovery: the app minted 144 valid reset links, customers
received almost none and retried up to 13 times each, because a person who had
entered the workflow once could never enter it again. Nothing surfaced the
failure — see "Seeing whether it worked" below, which is the fix for that half.

The link's host comes from `APP_URL`; without that set, it falls back to the
request's Host header, which an attacker can set. Set `APP_URL` in production.

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

The app writes an `email_log` row for **every** notification, and since 2026-09-02
that row also records what became of it.

Who delivers which kind is declared once, in `lib/email-delivery.ts`:

| Kind | Delivered by |
|---|---|
| `password_reset` | a PostHog workflow |
| `order_receipt`, `order_receipt_updated`, `settlement_placed`, `kahati_cancelled`, `status_*` | a PostHog workflow |
| `settlement_confirmed` | **nothing** — see below |
| anything unrecognised | **nothing** |

`SMTP_KINDS` in that module is deliberately empty: PostHog sends everything.
**Adding a kind to it while a workflow for the same event is live puts two copies
of the mail in the customer's inbox** — pause the workflow first.

### Seeing whether it worked

`email_log` used to record only that a mail had been *composed*. A transmitted
mail, a refused one, and one nothing would ever send were the same row. Combined
with having no Vercel log access on this project — so a failed send's
`console.error` reaches nobody — that is what let the password reset stay broken
for two weeks with no signal anywhere a human would look.

Each row now carries `delivered_by`, `status` and `error`:

| status | meaning |
|---|---|
| `sent` | the deliverer confirmed it (for a PostHog kind, the capture succeeded) |
| `queued` | handed to PostHog; the workflow's own outcome is not visible from here |
| `failed` | the deliverer refused it — `error` says why |
| `skipped` | nothing was configured to deliver it (`POSTHOG_KEY` unset) |
| `undeliverable` | no delivery route exists for this kind at all |
| `unknown` | written before these columns existed; genuinely not known |

Read them at **Admin → Emails** (`/admin/emails`), which opens on the count of
deliveries that are not confirmed. Rows written before 2026-09-02 are `unknown`
rather than backfilled as `sent` — nobody knows what happened to those 144, and
the table should say so.

`queued` is as far as the app can see. PostHog accepting the event does not prove
the workflow sent the mail; if `password_reset` rows read `sent` and customers
still report nothing arriving, the fault is in the workflow's re-entry or
suppression settings above, not in the app.

### Known gap: two kinds nothing delivers

`settlement_confirmed` (`app/api/admin/settlements/[id]/route.ts`) writes an
`email_log` row and fires **no** PostHog event, so no workflow can pick it up. The
admin-side order edit (`app/api/admin/orders/[id]/route.ts`) writes an
`order_receipt_updated` row and likewise fires no event, while the customer-side
edit at `app/api/orders/[id]/route.ts` does. Both now surface as `undeliverable`
or `queued`-without-an-event rather than looking sent. Neither is fixed here.
