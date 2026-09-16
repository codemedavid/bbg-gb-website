-- Korean products (the Aesthetics range) default to Group Buy, not Kahati.
-- Preserve other channels, catalog prices and all customer commitments.
UPDATE products SET is_kahati = false
WHERE category_id IN (SELECT id FROM categories WHERE slug = 'aesthetics');
--> statement-breakpoint
-- Retire only unused boards. Joined boards remain available for fulfillment.
UPDATE group_buys SET status = 'closed'
WHERE status IN ('open', 'scheduled') AND claimed_slots = 0
  AND product_id IN (
    SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id
    WHERE c.slug = 'aesthetics'
  );
