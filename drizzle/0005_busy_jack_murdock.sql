ALTER TYPE "public"."group_buy_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "group_buys" ALTER COLUMN "total_slots" SET DEFAULT 10;--> statement-breakpoint
ALTER TABLE "group_buys" ALTER COLUMN "min_vials" SET DEFAULT 1;