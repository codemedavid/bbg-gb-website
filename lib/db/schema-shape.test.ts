// Regression cover for the drift guard's reflection half.
//
// The first cut of declaredShape() skipped every enum: it filtered on
// `typeof value === 'object'`, but drizzle's pgEnum is a *function* carrying
// enumName/enumValues properties. The guard therefore compared zero enums and
// would have reported "no drift" against the exact database state that took the
// Kahati board down (group_buy_status missing 'cancelled').
//
// A guard that cannot fail is worse than no guard, so these assert it reads the
// real schema.ts rather than merely returning something.
import { describe, it, expect } from 'vitest';
import { declaredShape } from './schema-shape';

describe('declaredShape', () => {
  const shape = declaredShape();

  it('reflects every declared enum, not just tables', () => {
    expect(Object.keys(shape.enums).length).toBeGreaterThan(0);
  });

  it('includes group_buy_status with the cancelled value that caused the outage', () => {
    expect(shape.enums['group_buy_status']).toContain('cancelled');
  });

  it('includes order_item_kind with all three purchase kinds', () => {
    expect(shape.enums['order_item_kind']).toEqual(
      expect.arrayContaining(['product', 'group_buy', 'moq_campaign']),
    );
  });

  it('reflects tables with their snake_case column names', () => {
    expect(shape.tables['orders']).toEqual(
      expect.arrayContaining(['downpayment_php', 'courier', 'packed_by', 'total_usd']),
    );
    expect(shape.tables['order_items']).toContain('unit_price_usd');
  });

  it('covers every table the app declares', () => {
    expect(Object.keys(shape.tables)).toEqual(
      expect.arrayContaining(['orders', 'order_items', 'group_buys', 'moq_campaigns', 'payment_methods', 'users']),
    );
  });

  it('does not invent a table from a non-table export', () => {
    // settings constants and helper exports live in the same module namespace.
    for (const columns of Object.values(shape.tables)) {
      expect(columns.length).toBeGreaterThan(0);
    }
  });
});
