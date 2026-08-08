--- Korean products: available in Group Buy, never in Kahati.
---
--- A hatian splits ONE kit — ten vials — between ten people. The Korean
--- aesthetics and skin boosters are not sold that way: a Rejuran i is a single
--- prefilled syringe, a Rejuran Healer is a 2-pack, a Nabota is one unit. There
--- is nothing to split, so a hatian counter over them promises a per-vial share
--- of something that has no vials. They belong on the Group Buy board, where
--- customers pool whole kits.
---
--- A per-product flag rather than a category rule. "Korean" is the business's
--- name for this block, but the property that matters is how the supplier packs
--- it, and that is a fact about a product. A flag also means the admin can mark
--- next month's filler on the product form instead of waiting on a migration —
--- which is the difference between a rule that holds and one that rots.
---
--- Defaults to false, so every peptide keeps its counter and nothing that was
--- on the hatian board yesterday silently leaves it.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_korean" boolean DEFAULT false NOT NULL;--> statement-breakpoint

--- The current block, by category. Every product filed under Aesthetics is one
--- of these: the Rejurans, Profhilo, Hyaron, NCTF, Kiara Reju, Mesoestetic,
--- Restylane, the JUVEDERMs, Nabota, Rentox, Botox Gas, Xeomin, and the 5ml
--- microneedling peptide ampoules alongside them.
---
--- Keyed on the category rather than on a list of names, because names get
--- edited and a missed rename would silently put a syringe back on the hatian
--- board. This is a starting point, not a closed set — the flag is editable per
--- product, so an admin who disagrees about any one row changes it in the panel
--- rather than in another migration.
UPDATE "products" SET "is_korean" = true
WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE "slug" = 'aesthetics');--> statement-breakpoint

--- Retire the hatian counters those products are already carrying.
---
--- The flag stops NEW counters opening (lib/kahati-seed-bulk.ts) and hides the
--- rest from the board, but a counter left 'open' in the table still holds its
--- claimed vials against the one-open-per-product index — so the product could
--- never get a clean counter again if the flag were ever lifted. Only EMPTY
--- counters are closed: one that people have actually joined is a real
--- commitment with real money behind it and must run its course.
UPDATE "group_buys" SET "status" = 'closed'
WHERE "status" = 'open'
  AND "claimed_slots" = 0
  AND "product_id" IN (SELECT "id" FROM "products" WHERE "is_korean" = true);
