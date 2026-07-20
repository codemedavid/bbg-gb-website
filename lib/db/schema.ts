import {
  pgTable, uuid, text, varchar, integer, numeric, boolean,
  timestamp, jsonb, pgEnum, index, pgSequence,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// Order numbers come from a sequence so concurrent checkouts can never collide.
// Starts at 2418 to continue the existing BBG-#### series.
export const orderNoSeq = pgSequence('order_no_seq', { startWith: 2418 });

// ---- Enums -------------------------------------------------------------
export const roleEnum = pgEnum('user_role', ['customer', 'admin']);
export const buyTypeEnum = pgEnum('buy_type', ['solo', 'kahati', 'group_buy', 'moq']);
// Group Buy (MOQ) campaign lifecycle. 'reached' is derived (committed >= moq), not stored.
export const moqCampaignStatusEnum = pgEnum('moq_campaign_status', ['open', 'approved', 'cancelled']);
export const orderStatusEnum = pgEnum('order_status', [
  'proof_review',      // 0 Proof under review
  'payment_confirmed', // 1 Payment confirmed
  'batch_filling',     // 2 Batch filling
  'shipped',           // 3 Shipped
  'delivered',         // 4 Delivered
  'cancelled',
]);
// 'closed' = full (reached the 10-vial cap) or admin-closed; 'cancelled' = deadline
// passed before the cap was reached. Both are terminal for accepting new commits.
export const groupBuyStatusEnum = pgEnum('group_buy_status', ['open', 'closed', 'shipped', 'completed', 'cancelled']);
// White powder ships first; salt/blend/liquid (incl. NAD+) arrives 3-5 days later.
export const arrivalGroupEnum = pgEnum('arrival_group', ['white_powder', 'salt_liquid']);
export const orderItemKindEnum = pgEnum('order_item_kind', ['product', 'group_buy', 'moq_campaign', 'moq_product']);

// ---- Users -------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 200 }).notNull().unique(),
  phone: varchar('phone', { length: 40 }),
  passwordHash: text('password_hash').notNull(),
  address: text('address'),
  role: roleEnum('role').notNull().default('customer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Categories --------------------------------------------------------
export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 80 }).notNull(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
});

// ---- Products ----------------------------------------------------------
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 40 }),            // CAT/Code from price list
  name: varchar('name', { length: 160 }).notNull(),
  spec: varchar('spec', { length: 120 }).notNull(), // e.g. "15mg vial"
  categoryId: uuid('category_id').references(() => categories.id),
  pricePhp: numeric('price_php', { precision: 12, scale: 2 }).notNull(),
  priceUsd: numeric('price_usd', { precision: 12, scale: 2 }),
  // Admin-editable on-hand (ready stock) pricing
  isOnHand: boolean('is_on_hand').notNull().default(false),
  onHandKitPhp: numeric('on_hand_kit_php', { precision: 12, scale: 2 }),
  onHandPiecePhp: numeric('on_hand_piece_php', { precision: 12, scale: 2 }),
  stock: integer('stock').notNull().default(0),
  arrivalGroup: arrivalGroupEnum('arrival_group').notNull().default('white_powder'),
  description: text('description'),
  imageEmoji: varchar('image_emoji', { length: 8 }).default('💧'),
  isActive: boolean('is_active').notNull().default(true),
  soldCount: integer('sold_count').notNull().default(0), // for fast-moving analytics
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  catIdx: index('products_category_idx').on(t.categoryId),
  activeIdx: index('products_active_idx').on(t.isActive),
}));

// ---- Group buys (MOQ / Kahati) ----------------------------------------
export const groupBuys = pgTable('group_buys', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 160 }).notNull(),
  pricePerKitPhp: numeric('price_per_kit_php', { precision: 12, scale: 2 }).notNull(), // admin-editable
  // A hatian counter fills exactly one kit — 10 vials. On reaching this cap it
  // closes and a fresh sibling auto-opens (see lib/kahati-server.ts).
  totalSlots: integer('total_slots').notNull().default(10),     // vial cap per hatian (1 kit)
  claimedSlots: integer('claimed_slots').notNull().default(0),
  minVials: integer('min_vials').notNull().default(1),          // min vials one person may commit
  repackFeePhp: numeric('repack_fee_php', { precision: 12, scale: 2 }).notNull().default('150'),
  status: groupBuyStatusEnum('status').notNull().default('open'),
  closesAt: timestamp('closes_at', { withTimezone: true }),
  arrivalGroup: arrivalGroupEnum('arrival_group').notNull().default('white_powder'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Group Buy (MOQ) campaigns ----------------------------------------
// Distinct from group_buys (Kahati). A campaign holds customer commitments until
// its MOQ (in kits) is reached or the admin approves/extends/cancels it.
export const moqCampaigns = pgTable('moq_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 160 }).notNull(),
  pricePerKitPhp: numeric('price_per_kit_php', { precision: 12, scale: 2 }).notNull(),
  moq: integer('moq').notNull().default(10),               // kits target
  committed: integer('committed').notNull().default(0),    // kits committed so far
  perCustomerMin: integer('per_customer_min').notNull().default(1),
  // Pasabay packing fee (local shipping included); admin-editable per campaign.
  shippingPhp: numeric('shipping_php', { precision: 12, scale: 2 }).notNull().default('300'),
  status: moqCampaignStatusEnum('status').notNull().default('open'),
  deadline: timestamp('deadline', { withTimezone: true }),
  // Included products with per-product out-of-stock flags: [{ productId, name, outOfStock }]
  includedProducts: jsonb('included_products').notNull().default(sql`'[]'::jsonb`),
  arrivalGroup: arrivalGroupEnum('arrival_group').notNull().default('white_powder'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- MOQ products ------------------------------------------------------
// The MOQ shelf: a small, curated set of bulk items sold on their own page with
// a per-product minimum order quantity. Deliberately its own table rather than a
// flag on `products` — the admin screen for this shelf must not reach the main
// catalog, and blends like "TR30 + CGL5" are first-class rows here instead of
// synthetic catalog entries that could leak into the shop.
export const moqProducts = pgTable('moq_products', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 160 }).notNull(),
  spec: varchar('spec', { length: 120 }).notNull().default(''),
  description: text('description'),
  // Uploaded image (storage key in the `moq-images` bucket). The emoji is the
  // fallback the card renders when no image has been uploaded yet.
  imageKey: text('image_key'),
  imageEmoji: varchar('image_emoji', { length: 8 }).default('📦'),
  pricePhp: numeric('price_php', { precision: 12, scale: 2 }).notNull(),
  priceUsd: numeric('price_usd', { precision: 12, scale: 2 }),
  stock: integer('stock').notNull().default(0),
  // Minimum units a customer must order — the "MOQ" this page is named for.
  minOrderQty: integer('min_order_qty').notNull().default(1),
  // Per-listing packing fee override; falls back to the global packing_fee_moq.
  packingFeePhp: numeric('packing_fee_php', { precision: 12, scale: 2 }),
  arrivalGroup: arrivalGroupEnum('arrival_group').notNull().default('white_powder'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  activeIdx: index('moq_products_active_idx').on(t.isActive),
}));

// ---- Settings (global key/value config) --------------------------------
// Small key/value store for admin-editable global defaults (e.g. packing fees).
// Absent keys fall back to code constants, so an empty table is a valid state.
export const settings = pgTable('settings', {
  key: varchar('key', { length: 60 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Payment methods ---------------------------------------------------
// Admin-managed checkout payment options (GCash, Maya, …). Each holds the
// account details plus an optional QR image (stored in the `payment-qr` bucket).
export const paymentMethods = pgTable('payment_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: varchar('label', { length: 40 }).notNull(),          // e.g. "GCash"
  accountName: varchar('account_name', { length: 120 }).notNull(),
  accountNumber: varchar('account_number', { length: 60 }).notNull(),
  qrKey: text('qr_key'),                                       // storage key of QR image
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- COA files ---------------------------------------------------------
export const coaFiles = pgTable('coa_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
  batch: varchar('batch', { length: 40 }),
  fileName: varchar('file_name', { length: 200 }).notNull(),
  storageKey: text('storage_key').notNull(), // path/key in storage driver
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Orders ------------------------------------------------------------
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderNo: varchar('order_no', { length: 20 }).notNull().unique(), // BBG-2418
  userId: uuid('user_id').references(() => users.id).notNull(),
  status: orderStatusEnum('status').notNull().default('proof_review'),
  buyType: buyTypeEnum('buy_type').notNull().default('solo'),
  subtotalPhp: numeric('subtotal_php', { precision: 12, scale: 2 }).notNull(),
  // Single packing fee (local shipping incl., no admin fee). shipping_php/repack_fee_php
  // are kept for legacy orders written before the packing-fee model; new orders use packing_fee_php.
  packingFeePhp: numeric('packing_fee_php', { precision: 12, scale: 2 }).notNull().default('0'),
  shippingPhp: numeric('shipping_php', { precision: 12, scale: 2 }).notNull().default('0'),
  repackFeePhp: numeric('repack_fee_php', { precision: 12, scale: 2 }).notNull().default('0'),
  totalPhp: numeric('total_php', { precision: 12, scale: 2 }).notNull(),
  // Kahati reservation downpayment paid at checkout, deducted from total_php;
  // the balance (total - downpayment) is collected after the kahati ends. 0 for solo.
  downpaymentPhp: numeric('downpayment_php', { precision: 12, scale: 2 }).notNull().default('0'),
  // Delivery snapshot (captured at checkout — immutable record)
  shipName: varchar('ship_name', { length: 120 }).notNull(),
  shipPhone: varchar('ship_phone', { length: 40 }).notNull(),
  shipAddress: text('ship_address').notNull(),
  paymentMethod: varchar('payment_method', { length: 40 }), // snapshot of chosen method label (Payment column: BDO/GoTyme)
  paymentProofKey: text('payment_proof_key'), // storage key of uploaded proof
  trackingNo: varchar('tracking_no', { length: 80 }),
  // Weekly-report fulfilment fields (admin-editable). courier = Shipping column,
  // packedBy = the "Admin" handler column, totalUsd = the report's USD order total
  // (sum of order_items.unit_price_usd × qty, snapshotted at checkout).
  courier: varchar('courier', { length: 40 }).notNull().default('J&T'),
  packedBy: varchar('packed_by', { length: 60 }),
  totalUsd: numeric('total_usd', { precision: 12, scale: 2 }).notNull().default('0'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index('orders_user_idx').on(t.userId),
  createdIdx: index('orders_created_idx').on(t.createdAt),
  statusIdx: index('orders_status_idx').on(t.status),
}));

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
  kind: orderItemKindEnum('kind').notNull().default('product'),
  productId: uuid('product_id').references(() => products.id),
  groupBuyId: uuid('group_buy_id').references(() => groupBuys.id),
  moqCampaignId: uuid('moq_campaign_id').references(() => moqCampaigns.id),
  moqProductId: uuid('moq_product_id').references(() => moqProducts.id),
  nameSnapshot: varchar('name_snapshot', { length: 200 }).notNull(),
  specSnapshot: varchar('spec_snapshot', { length: 120 }),
  unitPricePhp: numeric('unit_price_php', { precision: 12, scale: 2 }).notNull(),
  // USD unit price snapshot (from products.price_usd) for the weekly report's
  // "@ $x.xx" line and USD totals. Null for items with no USD price (e.g. kahati).
  unitPriceUsd: numeric('unit_price_usd', { precision: 12, scale: 2 }),
  qty: integer('qty').notNull(),
  lineTotalPhp: numeric('line_total_php', { precision: 12, scale: 2 }).notNull(),
}, (t) => ({
  orderIdx: index('order_items_order_idx').on(t.orderId),
  productIdx: index('order_items_product_idx').on(t.productId),
}));

export const orderStatusHistory = pgTable('order_status_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
  status: orderStatusEnum('status').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const emailLog = pgTable('email_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  toEmail: varchar('to_email', { length: 200 }).notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  kind: varchar('kind', { length: 60 }).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Relations ---------------------------------------------------------
export const usersRelations = relations(users, ({ many }) => ({ orders: many(orders) }));
export const categoriesRelations = relations(categories, ({ many }) => ({ products: many(products) }));
export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  coaFiles: many(coaFiles),
}));
export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  items: many(orderItems),
  history: many(orderStatusHistory),
}));
export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

// Ordered status list mirrored by the client timeline
export const ORDER_STATUS_FLOW = ['proof_review', 'payment_confirmed', 'batch_filling', 'shipped', 'delivered'] as const;
export type OrderStatus = typeof orderStatusEnum.enumValues[number];
