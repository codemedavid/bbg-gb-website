--- A payment method now says what it is FOR.
---
--- The hatian downpayment QR has to be a different image from the full-payment
--- QR — often one encoding a fixed amount, so the customer cannot accidentally
--- send the whole order price for a kit that has not filled yet and then need
--- refunding when it doesn't. Two QRs in one undifferentiated list would rely on
--- the checkout picking correctly every time; a column lets it SELECT correctly
--- instead, which is the difference between a rule and an invariant.
---
--- NOT NULL DEFAULT 'full' because every row that already exists is a
--- full-payment method — that was the only kind there was.
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "purpose" varchar(30) DEFAULT 'full' NOT NULL;--> statement-breakpoint
--- Optional per-method instructions shown under the QR at checkout.
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "instructions" text;
