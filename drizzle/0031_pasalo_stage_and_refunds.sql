--- Pasalo (Bunuan): a second chance before anyone is refunded.
---
--- A hatian counter needs 7 vials to be worth ordering and holds 10. Until now
--- a counter that reached its deadline at 3 was CANCELLED — the batch was never
--- placed and every participant was refunded, four vials short of a batch that
--- would have gone ahead.
---
--- Pasalo inserts a stage between those two facts. When the admin closes
--- Kahati, a counter at 1-6 moves to 'pasalo' instead of 'cancelled' and keeps
--- selling on a second, admin-set clock. Only when the admin closes Pasalo is
--- the outcome decided, and only what is STILL below the minimum is refunded.
---
--- Deliberately the same counter row, not a parallel system: the same guarded
--- claim, the same 10-vial database cap, the same cart, checkout, packing fee
--- and settlement. Pasalo is a phase of a hatian, not a second kind of hatian.

--- 'pasalo' rather than a separate boolean, for two reasons that are both about
--- constraints already in this schema:
---
---  - group_buys_one_open_per_product_idx is PARTIAL, on status = 'open'. A
---    pasalo counter therefore does not occupy its product's one open slot, so
---    the next cycle can open a fresh counter beside it without the index
---    arbitrating between them.
---  - lib/settlement.ts settles orders whose counters are all in
---    ('closed','shipped','completed'). A pasalo counter is in none of those,
---    so isReadyToSettle already makes an order wait for the Pasalo outcome —
---    a customer cannot settle and be refunded for the same vial.
ALTER TYPE "group_buy_status" ADD VALUE IF NOT EXISTS 'pasalo';--> statement-breakpoint

--- Vials the counter held at the moment Kahati closed, frozen there.
---
--- claimed_slots keeps moving through Pasalo, so without this the two halves of
--- the total are unrecoverable — and "3 Kahati + 2 Pasalo" is exactly what the
--- dashboard and the refund report have to be able to say. Pasalo vials are
--- derived (claimed_slots - kahati_vials) rather than counted in a third column,
--- so the two figures cannot drift out of agreement with the counter itself.
---
--- Null means Kahati has not been closed on this counter yet: every vial on it
--- is a Kahati vial, because Pasalo has not happened.
ALTER TABLE "group_buys" ADD COLUMN IF NOT EXISTS "kahati_vials" integer;--> statement-breakpoint

--- The Pasalo deadline, set by the admin per counter. Its own column rather
--- than reusing closes_at, which belongs to the Kahati stage and is what the
--- storefront counted down to — overwriting it would erase the record of when
--- Kahati actually ended.
---
--- Advisory in one specific sense: passing it stops NEW commitments (the
--- checkout guard already refuses a counter past its deadline), but it decides
--- nothing on its own. The outcome — qualified or refunded — is settled by an
--- admin closing the stage, never by a clock. There is no scheduler in this
--- app, and a sweep that cancelled orders and booked refunds unattended at 3am
--- is not a thing anybody asked for.
ALTER TABLE "group_buys" ADD COLUMN IF NOT EXISTS "pasalo_closes_at" timestamp with time zone;--> statement-breakpoint

--- The 7 becomes data. It was a constant in lib/pricing.ts, which meant every
--- counter ever created was judged by whatever the constant says TODAY — so
--- changing the business rule would retroactively re-decide finished batches,
--- including ones already refunded. Frozen per counter instead, defaulting to
--- the same 7 every existing row was created under.
ALTER TABLE "group_buys" ADD COLUMN IF NOT EXISTS "min_viable_vials" integer DEFAULT 7 NOT NULL;--> statement-breakpoint

--- What we owe one customer for one failed line, and whether it has been paid.
---
--- Nothing in this schema has ever recorded a refund. A cancelled hatian sent an
--- email and stopped; the amount, the reason and whether the money ever went
--- back existed only in whoever remembered. This is that record.
---
--- Keyed on the ORDER ITEM, not the order. A kahati cart splits into ONE order
--- per mode (lib/order-modes.ts), so one order routinely holds lines against
--- three different counters — and when one of them fails the other two are
--- fine. Refunding at order granularity is what forced the whole order to be
--- cancelled; refunding at item granularity is what lets Product A ship while
--- Product B is paid back.
CREATE TABLE IF NOT EXISTS "order_item_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  --- UNIQUE is the whole anti-double-count guarantee. "The same failed item
  --- cannot appear twice in the refund calculation" is a property of this
  --- index, not a rule the export is trusted to remember — so closing Pasalo
  --- twice, or re-running an evaluation, cannot book a second refund.
  "order_item_id" uuid NOT NULL UNIQUE REFERENCES "order_items"("id") ON DELETE CASCADE,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "group_buy_id" uuid REFERENCES "group_buys"("id"),

  --- The money, split so the sheet can explain itself. `goods_php` is the line
  --- total, owed only where that money was actually collected; `deposit_php` is
  --- this customer's checkout deposit, owed only when every line they hold in
  --- the batch failed and the parcel therefore never ships. `amount_php` is the
  --- sum, computed once at close and stored — the export must never re-derive a
  --- figure that was already decided, or two downloads can disagree.
  "goods_php" numeric(12, 2) DEFAULT '0' NOT NULL,
  "deposit_php" numeric(12, 2) DEFAULT '0' NOT NULL,
  "amount_php" numeric(12, 2) NOT NULL,

  --- Why that amount and not the line total: which of the customer's payments
  --- had actually cleared when the stage closed. Stored rather than re-read,
  --- because a settlement paid AFTER the refund was decided must not silently
  --- change what the refund was for.
  "collected_basis" varchar(30) NOT NULL,

  --- The sentence the admin and the customer both get, e.g. "Final combined
  --- quantity 5/7 minimum after Pasalo closed."
  "reason" text NOT NULL,

  --- What was ordered, copied rather than joined. The order item survives a
  --- refund (a customer's history must still show what they bought), but it is
  --- editable and its product can be renamed or repriced afterwards — so a
  --- sheet that read the name and the price back through the join would not
  --- reproduce. These four columns are what the export prints.
  "name_snapshot" varchar(200) DEFAULT '' NOT NULL,
  "qty" integer DEFAULT 0 NOT NULL,
  "unit_price_php" numeric(12, 2) DEFAULT '0' NOT NULL,
  "line_total_php" numeric(12, 2) DEFAULT '0' NOT NULL,

  --- The counter's final arithmetic, frozen. The counter row keeps living — it
  --- can be edited, and its product can start a new cycle — so a refund that
  --- pointed at it for its evidence would quietly restate its own reason.
  "kahati_vials" integer DEFAULT 0 NOT NULL,
  "pasalo_vials" integer DEFAULT 0 NOT NULL,
  "combined_vials" integer DEFAULT 0 NOT NULL,
  "min_required" integer DEFAULT 7 NOT NULL,

  --- pending -> processing -> refunded, or failed. Never set by an export:
  --- downloading a spreadsheet is not evidence that money moved, so the file
  --- always leaves here saying PENDING and only an explicit admin action marks
  --- one paid. varchar rather than a pg enum, matching orders.payment_status
  --- and payment_methods.purpose — the value set is owned by
  --- lib/refund-status.ts, which the browser imports too.
  "status" varchar(20) DEFAULT 'pending' NOT NULL,

  --- Filled when the money actually goes back. `refund_account` exists because
  --- the customer's own GCash/Maya/bank number is not stored anywhere in this
  --- system — payment_methods holds OUR accounts — so whoever sends the refund
  --- records where they sent it.
  "reference" varchar(80),
  "method" varchar(40),
  "refund_account" varchar(120),
  "refunded_at" timestamp with time zone,
  "refunded_by" uuid REFERENCES "users"("id"),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  --- A refund is money leaving. Negative is not a smaller refund, it is a
  --- charge — and the arithmetic that produces these figures subtracts, so the
  --- floor lives in the database rather than in the function that got it right
  --- today. (Requirement: "refund total cannot become negative".)
  CONSTRAINT "order_item_refunds_amount_non_negative" CHECK ("amount_php" >= 0)
);--> statement-breakpoint

--- "Who do I still owe" is the question this table exists to answer, and it is
--- a question about the status. The rest support the export's own joins.
CREATE INDEX IF NOT EXISTS "order_item_refunds_status_idx" ON "order_item_refunds" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_item_refunds_user_idx" ON "order_item_refunds" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_item_refunds_order_idx" ON "order_item_refunds" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_item_refunds_group_buy_idx" ON "order_item_refunds" ("group_buy_id");
