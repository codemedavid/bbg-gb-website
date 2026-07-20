// Schema-drift detection.
//
// The pglite test harness builds every table fresh from schema.ts, so it can
// never notice that the *deployed* database is behind. That blind spot took the
// Kahati board down in production: schema.ts declared group_buy_status's
// 'cancelled' value and orders.downpayment_php, the live database had neither,
// and GET /api/groupbuys answered 500 while all 276 tests stayed green.
//
// diffSchema is the pure core of the guard — it compares what schema.ts declares
// against what the database actually reflects.
import { describe, it, expect } from 'vitest';
import { diffSchema, formatDrift, type SchemaShape } from './drift';

const shape = (o: Partial<SchemaShape>): SchemaShape => ({ tables: {}, enums: {}, ...o });

describe('diffSchema', () => {
  it('reports no drift when the database matches the schema', () => {
    const expected = shape({
      tables: { orders: ['id', 'total_php'] },
      enums: { group_buy_status: ['open', 'closed'] },
    });

    const drift = diffSchema(expected, expected);

    expect(drift.hasDrift).toBe(false);
    expect(drift.missingTables).toEqual([]);
    expect(drift.missingColumns).toEqual([]);
    expect(drift.missingEnumValues).toEqual([]);
  });

  it('names a column the schema declares but the database lacks', () => {
    const expected = shape({ tables: { orders: ['id', 'downpayment_php'] } });
    const actual = shape({ tables: { orders: ['id'] } });

    const drift = diffSchema(expected, actual);

    expect(drift.hasDrift).toBe(true);
    expect(drift.missingColumns).toEqual(['orders.downpayment_php']);
  });

  it('names an enum value the schema declares but the database lacks', () => {
    const expected = shape({ enums: { group_buy_status: ['open', 'cancelled'] } });
    const actual = shape({ enums: { group_buy_status: ['open'] } });

    const drift = diffSchema(expected, actual);

    expect(drift.hasDrift).toBe(true);
    expect(drift.missingEnumValues).toEqual(['group_buy_status.cancelled']);
  });

  it('reports a whole missing table once, not one row per column', () => {
    const expected = shape({ tables: { moq_campaigns: ['id', 'moq', 'committed'] } });
    const actual = shape({ tables: {} });

    const drift = diffSchema(expected, actual);

    expect(drift.missingTables).toEqual(['moq_campaigns']);
    expect(drift.missingColumns).toEqual([]);
  });

  it('ignores extra tables, columns and enum values the database has spare', () => {
    // A dropped-but-not-yet-cleaned column is not a deploy blocker; only things
    // the running code expects and cannot find are.
    const expected = shape({ tables: { orders: ['id'] }, enums: { s: ['a'] } });
    const actual = shape({ tables: { orders: ['id', 'legacy_col'], old_table: ['x'] }, enums: { s: ['a', 'b'] } });

    expect(diffSchema(expected, actual).hasDrift).toBe(false);
  });

  it('collects every missing item rather than stopping at the first', () => {
    const expected = shape({
      tables: { orders: ['id', 'courier', 'total_usd'], order_items: ['id', 'unit_price_usd'] },
      enums: { group_buy_status: ['open', 'cancelled'] },
    });
    const actual = shape({
      tables: { orders: ['id'], order_items: ['id'] },
      enums: { group_buy_status: ['open'] },
    });

    const drift = diffSchema(expected, actual);

    expect(drift.missingColumns).toEqual([
      'orders.courier', 'orders.total_usd', 'order_items.unit_price_usd',
    ]);
    expect(drift.missingEnumValues).toEqual(['group_buy_status.cancelled']);
  });
});

describe('formatDrift', () => {
  it('summarises a clean database in one line', () => {
    expect(formatDrift(diffSchema(shape({}), shape({})))).toBe('Database matches schema.ts — no drift.');
  });

  it('lists each missing item and names the fix', () => {
    const drift = diffSchema(
      shape({ tables: { orders: ['id', 'courier'] }, enums: { s: ['a', 'b'] } }),
      shape({ tables: { orders: ['id'] }, enums: { s: ['a'] } }),
    );

    const text = formatDrift(drift);

    expect(text).toContain('orders.courier');
    expect(text).toContain('s.b');
    expect(text).toContain('npm run db:push');
  });
});
