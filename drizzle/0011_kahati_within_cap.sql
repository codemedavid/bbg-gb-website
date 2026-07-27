--- A hatian holds exactly one kit. "13 / 10 vials" is a state the business says
--- cannot exist, so the ceiling moves into the database: from here on no path —
--- checkout, admin edit, a script or a console query — can write a counter past
--- its cap. Overflow opens the next counter instead (lib/kahati-server.ts).
---
--- Clamp first: ADD CONSTRAINT is rejected outright if any existing row violates
--- it, and rows written before this constraint (or by hand) may already be over.
--- Clamping down rather than raising the cap is the safe direction — it never
--- invents vials nobody committed, and the surplus is picked up by the sweep
--- that seals the full counter and opens its successor.
UPDATE "group_buys" SET "claimed_slots" = "total_slots" WHERE "claimed_slots" > "total_slots";--> statement-breakpoint
ALTER TABLE "group_buys" ADD CONSTRAINT "group_buys_claimed_within_cap" CHECK ("claimed_slots" <= "total_slots");
