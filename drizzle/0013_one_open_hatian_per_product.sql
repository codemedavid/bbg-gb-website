--- At most one OPEN hatian counter per product, enforced by the database.
---
--- The hatian board reconciles itself against the group buy product list on read
--- (app/api/groupbuys/route.ts), and that read is public and polled every 15s.
--- Two requests arriving together both see a product as unlisted before either
--- INSERT commits, and both insert. No amount of application-side checking
--- closes that window; a unique index does.
---
--- Partial, on open counters only: the counters a product has already finished
--- are history and may pile up freely. Rows with a NULL product_id — every
--- hatian written before the column existed, plus any free-text counter an admin
--- makes by hand — are exempt, because NULLs are distinct in a unique index.
---
--- Dedup first, in the same spirit as 0011: CREATE UNIQUE INDEX is rejected
--- outright if any duplicate already exists. Only EMPTY duplicates are retired,
--- and the survivor is the counter carrying the most vials (earliest created
--- breaks a tie) — so this can never strand a customer's commitment. If two
--- counters for one product both hold vials, this migration FAILS rather than
--- guessing, which is the correct outcome: that is a data question for a human.
UPDATE "group_buys" SET "status" = 'closed'
WHERE "status" = 'open'
  AND "claimed_slots" = 0
  AND "product_id" IS NOT NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("product_id") "id"
    FROM "group_buys"
    WHERE "status" = 'open' AND "product_id" IS NOT NULL
    ORDER BY "product_id", "claimed_slots" DESC, "created_at" ASC
  );--> statement-breakpoint
CREATE UNIQUE INDEX "group_buys_one_open_per_product_idx" ON "group_buys" ("product_id") WHERE "status" = 'open';
