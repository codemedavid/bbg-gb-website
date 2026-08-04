--- Correcting the kit_size backfill for the products that do not ship in kits.
---
--- 0013 added the column and backfilled six price-list codes (LB10, CK-PRF, …).
--- None of those codes exist in the live catalogue — every one of those products
--- is stored with a NULL code — so that backfill matched zero rows and left every
--- per-piece product at the default 10. The Kits column on the weekly report is
--- qty / kit_size, so each of these would have under-ordered by its own factor:
--- 20 pieces of Botox would have printed as "2 kits".
---
--- Matched on name, not on id: production UUIDs would make this migration
--- unrunnable against a local database or the test harness. Matched on name AND
--- spec, so a future product that reuses a name with a different pack size is
--- not silently caught by a rule written for this one.
---
--- The values are derived by lib/kit-size.ts from each product's own spec text
--- and were reviewed against the live catalogue before being applied. The list
--- lives in lib/kit-size-catalog.ts, and lib/kit-size-catalog.test.ts fails if
--- this file and that list ever disagree.
---
--- Idempotent: re-running sets the same rows to the same values.

--- Sold one at a time — "per piece", or a single 1ml/2ml syringe.
UPDATE "products" SET "kit_size" = 1
WHERE "name" IN (
  'Botox Gas',
  'Mesoestetic Mesohyal Organic Silicon',
  'Nabota',
  'Rejuran Trueskin',
  'Rentox',
  'Profhilo',
  'Rejuran hb',
  'Rejuran i',
  'Rejuran s',
  'Restylane Skin Booster'
);--> statement-breakpoint

--- Boxed in pairs: "2x1ml" and "2x2ml prefilled syringes".
UPDATE "products" SET "kit_size" = 2
WHERE "name" IN (
  'JUVEDERM Ultra 2',
  'JUVEDERM Ultra 3',
  'JUVEDERM Ultra 4',
  'JUVEDERM Voluma',
  'Rejuran Essence',
  'Rejuran Healer'
);--> statement-breakpoint

--- "2.2mlx3 prefilled syringes".
UPDATE "products" SET "kit_size" = 3
WHERE "name" IN ('Kiara Reju');--> statement-breakpoint

--- "3mlx5 vials" — five per box, which neither the code-based backfill nor a
--- blanket per-piece rule would have caught.
UPDATE "products" SET "kit_size" = 5
WHERE "name" IN ('NCTF135HA', 'NCTF135HA Plus');
