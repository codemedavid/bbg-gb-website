// Parameter binding in the dashboard's fee aggregate.
//
// The pglite test harness hides this one. Its driver happily serialises a JS
// Date bound as a bare query parameter; postgres-js — the driver every
// deployment uses — cannot, because a Date interpolated into a raw `sql`
// template carries no column type to map it through. The result was a
// production-only 500 on GET /api/admin/stats while every test stayed green
// and the SQL itself, run by hand, was perfectly valid:
//
//   TypeError: The "string" argument must be of type string or an instance of
//   Buffer or ArrayBuffer. Received an instance of Date
//       at Bind (postgres/src/connection.js:954)
//
// Drizzle's comparison helpers (gte(orders.createdAt, date)) do not have this
// problem — they know the column and apply its driver mapper. Only a Date
// dropped straight into a `sql` fragment does. So the invariant worth guarding
// is not "the SQL is correct" but "every bound parameter is a primitive the
// wire protocol can encode".
import { describe, it, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './db/schema';
import { feeColumns } from './analytics';

// toSQL() needs no connection — it only renders the query and its parameters.
const db = drizzle({} as never, { schema }) as never as {
  select: (fields: unknown) => { from: (t: unknown) => { toSQL: () => { params: unknown[] } } };
};

describe('feeColumns', () => {
  it('binds the period boundaries as wire-encodable parameters, not Date objects', () => {
    const weekStart = new Date('2026-08-16T00:00:00.000Z');
    const monthStart = new Date('2026-07-24T00:00:00.000Z');

    const { params } = db
      .select(feeColumns(schema.orders.createdAt, schema.orders.packingFeePhp, weekStart, monthStart))
      .from(schema.orders)
      .toSQL();

    // A Date here is exactly what postgres-js rejects at Bind time.
    expect(params.some((p) => p instanceof Date)).toBe(false);
    expect(params).toContain(weekStart.toISOString());
    expect(params).toContain(monthStart.toISOString());
  });
});
