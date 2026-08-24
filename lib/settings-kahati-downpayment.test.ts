// The hatian downpayment policy, stored in the `settings` table.
//
// The figure decides what a customer is asked to send at checkout, so a
// half-written or corrupt policy must not be able to quote a number nobody
// configured. It degrades to the packing-fee rule that predates it instead.
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, settings } from '@/lib/db';
import { resetDb } from '@/lib/test/harness';
import { getKahatiDownpaymentPolicy, setKahatiDownpaymentPolicy } from '@/lib/settings';
import { DEFAULT_KAHATI_DOWNPAYMENT_POLICY } from '@/lib/kahati-downpayment';

beforeEach(resetDb);

describe('kahati downpayment policy setting', () => {
  it('is the packing-fee rule when nothing has ever been configured', async () => {
    // Arrange — a database with no settings rows at all.
    // Act
    const policy = await getKahatiDownpaymentPolicy();
    // Assert — the behaviour that predates this feature, unchanged.
    expect(policy).toEqual(DEFAULT_KAHATI_DOWNPAYMENT_POLICY);
  });

  it('stores and reads back a flat downpayment', async () => {
    const saved = await setKahatiDownpaymentPolicy({
      mode: 'fixed', amountPhp: 500, percent: 0, refundable: true, policyNote: null,
    });
    expect(saved.mode).toBe('fixed');
    expect(saved.amountPhp).toBe(500);
    expect(await getKahatiDownpaymentPolicy()).toEqual(saved);
  });

  it('stores and reads back a percentage downpayment with its refund terms', async () => {
    const saved = await setKahatiDownpaymentPolicy({
      mode: 'percent', amountPhp: 0, percent: 25, refundable: false,
      policyNote: 'Forfeited if you back out after the kit is confirmed.',
    });
    expect(saved).toEqual({
      mode: 'percent', amountPhp: 0, percent: 25, refundable: false,
      policyNote: 'Forfeited if you back out after the kit is confirmed.',
    });
  });

  it('refuses a percentage outside 0-100 rather than quoting a nonsense figure', async () => {
    await expect(setKahatiDownpaymentPolicy({
      mode: 'percent', amountPhp: 0, percent: 140, refundable: true, policyNote: null,
    })).rejects.toThrow(/percent/i);
  });

  it('refuses a negative flat amount', async () => {
    await expect(setKahatiDownpaymentPolicy({
      mode: 'fixed', amountPhp: -1, percent: 0, refundable: true, policyNote: null,
    })).rejects.toThrow(/zero or more/i);
  });

  it('refuses a fixed policy that would collect nothing — that is the packing-fee rule, said unclearly', async () => {
    await expect(setKahatiDownpaymentPolicy({
      mode: 'fixed', amountPhp: 0, percent: 0, refundable: true, policyNote: null,
    })).rejects.toThrow(/more than zero/i);
  });

  it('degrades a corrupt stored mode to the packing-fee rule', async () => {
    // Arrange — a row written by hand, or by an older/newer deploy.
    const db = await getDb();
    await db.insert(settings).values({ key: 'kahati_downpayment_mode', value: 'bananas' });
    // Act / Assert — the checkout still has a rule it can quote.
    expect((await getKahatiDownpaymentPolicy()).mode).toBe('packing_fee');
  });
});
