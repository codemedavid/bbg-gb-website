// Integration tests for the public settings endpoint the storefront reads
// before checkout (packing-fee defaults + kahati downpayment).
import { describe, it, expect, beforeEach } from 'vitest';

const { GET } = await import('./route');
const { resetDb } = await import('@/lib/test/harness');

beforeEach(async () => {
  await resetDb();
});

describe('GET /api/settings', () => {
  it('returns the packing-fee defaults without auth', async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.packingFees).toEqual({ solo: 200, kahati: 150, group_buy: 300, moq: 200 });
  });
});
