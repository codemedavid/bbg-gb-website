--- Sales channels: three independent per-product switches.
---
--- The shop sells the same catalogue three ways — On-Hand (ready stock),
--- Group Buy (the `moq_campaigns` board, which pools whole kits) and Kahati
--- (the `group_buys` counters, which split one kit into vials). Until now
--- `is_group_buy` drove BOTH boards, so a product could not be offered on one
--- without the other, and the "not splittable per vial" exclusion had to be
--- bolted on as a separate `is_korean` veto.
---
--- This replaces that veto with a switch of its own. Same outcome for a
--- Rejuran, but the rule generalises: any product can now be any combination of
--- the three, decided by the admin on the product form rather than by a
--- category rule in the code.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_kahati" boolean DEFAULT false NOT NULL;--> statement-breakpoint

--- Backfill so that no product's current availability changes.
---
--- A product had a hatian counter exactly when it was flagged for group buy AND
--- was not vetoed as Korean, so that expression IS its Kahati switch. Every
--- peptide keeps its counter; every aesthetics product stays off the board it
--- was already off.
---
--- Guarded on the column's existence because `is_korean` may never have reached
--- this database: it shipped in 0018 alongside this work and an environment
--- that skipped it must still land on the right answer rather than erroring on
--- a column that is not there. Without it, the veto never existed, so the group
--- buy flag alone is the honest source.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'is_korean'
  ) THEN
    UPDATE "products" SET "is_kahati" = "is_group_buy" AND NOT "is_korean";
  ELSE
    UPDATE "products" SET "is_kahati" = "is_group_buy";
  END IF;
END $$;--> statement-breakpoint

--- Retire the veto. Leaving it would give the same decision two homes, and the
--- next person to add a product would have to know which one wins.
ALTER TABLE "products" DROP COLUMN IF EXISTS "is_korean";
