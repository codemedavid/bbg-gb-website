# MOQ batch auto-splitting

**Client rule:** a MOQ batch holds at most **10 kits**. 11/10, 12/10 and 13/10 must be
unreachable. A batch that fills is completed and closed immediately, and anything ordered
beyond its remaining capacity opens the next batch and continues there.

## What was actually wrong

Three surfaces in this app look like "MOQ", and only one of them could overfill:

| Surface | Table | Cap before this change |
|---|---|---|
| Kahati / hatian (`/kahati`) | `group_buys` | 10 vials, already enforced in SQL, already auto-splits |
| MOQ shelf (`/moq`) | `moq_products` | per-item minimum, no batches at all |
| **Group Buy campaigns (`/groupbuy`)** | **`moq_campaigns`** | **none** |

`moq_campaigns.committed` was a free-running counter with no ceiling and no successor:
`POST /api/campaigns/:id/commit` did a single unguarded `committed = committed + qty`.
`CampaignCard.tsx` documented the consequence as intended behaviour — *"a campaign may
exceed its MOQ … '14 / 10 kits' is the honest number"*. That is the number the client
called impossible, so the rule, not just the display, changed.

The batch is measured in **kits** (confirmed with the client), matching what
`moq_campaigns.moq` and the commit sheet already meant.

## The model

A campaign row is now one **batch**. Successive batches of one campaign form a **series**:

- `series_id` — the id of batch #1 (its own id for a first batch), so the whole series is
  one indexed read away.
- `batch_no` — 1, 2, 3 … within the series.
- `moq_campaign_status` gains `completed` — filled to capacity and closed. Only reachable
  by filling; no admin write produces it.
- Unique index on `(series_id, batch_no)` — two customers filling the same batch at the
  same instant cannot mint two "batch #2"s.

`batchCapacity(moq) = clamp(moq, 1, MOQ_BATCH_MAX_KITS)`. The clamp is what protects rows
written *before* the cap existed: a legacy `moq = 25` batch still caps at 10, and a legacy
`committed = 13` row renders 10/10, never 13/10.

## RED

`lib/group-buy.test.ts` — the allocation rule as pure functions, including the client's
three worked examples verbatim:

- 8/10 + 5 → `[{2, fills}, {3}]`
- 10/10 + 4 → `[{4}]`
- 9/10 + 14 → `[{1, fills}, {10, fills}, {3}]`
- exhaustive: every `(committed 0..10) × (qty 1..25)` allocates each kit exactly once

`app/api/campaigns/batch-split.test.ts` — the same rules against a real database, plus the
cases only integration can prove: one order carrying one line per batch under a single
packing fee, a commitment against a completed batch landing in its open successor rather
than opening a duplicate, four parallel commitments holding the cap, and a legacy
over-committed row reading 10/10 on the public board.

30 tests failed before implementation.

## GREEN

**Pure** (`lib/pricing.ts`, `lib/group-buy.ts`) — `MOQ_BATCH_MAX_KITS`, `batchCapacity`,
`isBatchFull`, `planBatchAllocation`, `nextBatchDeadline`, `describeBatch`.
`groupBuyMoqStatus` now reports a clamped count plus `capacity` and `full`.

**Server** (`lib/moq-batch-server.ts`) — `allocateCommitment` walks the series, and every
claim is a guarded conditional UPDATE:

```sql
WHERE id = $current AND status = 'open'
  AND committed + $take <= LEAST(moq, 10)
```

The ceiling lives in the database, not in application code, which is the difference
between "cannot exceed 10" and "usually does not exceed 10". A refused claim is not an
error — the batch is re-read and the kits land in the successor. `completeFullBatch` flips
the batch to `completed` guarded on `status = 'open'`, so of two racers exactly one seals
it and opens the successor; the loser joins that successor rather than creating its own.

**Route** — `POST /api/campaigns/:id/commit` writes ONE order with one `order_items` row
per batch, each pointing at the batch that holds those kits, and one packing fee. Splitting
a batch must not split the bill. A commitment aimed at a `completed` batch is redirected to
the series' open batch (and opens one if the series somehow has none), which is the
client's Example 2; `cancelled` and `approved` still refuse.

**UI** — `CampaignCard` and the admin board show `Batch #N`, `committed / capacity kits`,
remaining slots, and an Open / Completed / Approved / Cancelled badge. The admin MOQ field
is capped at 10 in the form and in `moqCampaignSchema`, so no admin can configure a
campaign that would legitimise an 11/10 counter.

An admin can still **cancel** a completed batch — a supplier can fall through after a batch
closes — but approving or extending a full batch is refused as meaningless.

## Deployment

`drizzle/0010_striped_northstar.sql` adds the enum value, the two columns, the backfill
(`series_id = id` for every existing campaign) and the indexes.

**Applied to production 2026-07-27**, in two steps — Postgres will not let a new enum value
be *used* in the same transaction that adds it, so `completed` was committed first and the
columns second. `npm run db:check` reports no drift.

Two live rows needed correcting, both agreed with the client:

- **Retatrutide 20mg — GB test** was the reported 13/10, status `open`. Marked `completed`
  and Batch #2 opened in its series. `committed` stays 13: that is the true record of what
  customers committed, and the cap now governs the display and the lifecycle, not history.
- **FUAN GTT150** was configured `moq = 160` with no commitments — a capacity the cap can
  no longer honour. Set to 10 so the record says what the system enforces.

## Result

741 tests pass. No batch can be written above its capacity, no batch can be rendered above
it, and a commitment of any size is allocated across as many batches as it needs without
losing or duplicating a kit.
