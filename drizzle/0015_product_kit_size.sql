--- Kit size, so the weekly report can state the batch order in supplier units.
---
--- The weekly report has always counted vials, because vials are what a buyer
--- orders. The supplier is ordered from in kits, and the team was doing that
--- division in their heads off the order sheet every week — 270 vials of BA5 is
--- 27 kits, but 33 bottles of LB50 is 33, because not everything ships ten to a
--- box. Getting that wrong orders the wrong quantity.
---
--- 10 is the default because it is the overwhelming majority: a peptide kit is
--- ten vials, which is the same "one kit = 10 vials" rule group_buys.total_slots
--- already encodes for hatian counters. Backfilling the exceptions is therefore
--- a short list rather than a full catalogue pass.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "kit_size" integer DEFAULT 10 NOT NULL;--> statement-breakpoint

--- Fillers and serums are sold per piece, so their kit count is their quantity.
--- Keyed on code rather than name: codes are the price-list identity and stay
--- stable across the renames a product name goes through.
---
--- This is a starting point, not a closed set — kit_size is admin-editable on
--- the product form, so a product that turns out to ship differently is one
--- field edit rather than another migration.
UPDATE "products" SET "kit_size" = 1
WHERE "code" IN ('LB10', 'LB50', 'CK-LMB', 'CK-PRF', 'CK-RSTG', 'CK-RSTB');
