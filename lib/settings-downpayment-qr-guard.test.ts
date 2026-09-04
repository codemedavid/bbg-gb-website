// Turning on the hatian deposit with nowhere to send it.
//
// The two halves of this feature are configured in different admin screens and
// nothing connected them. Checkout refuses to collect a deposit against the
// full-payment QR — deliberately, and it must keep refusing, because paying a
// whole order for a kit that may never fill is the thing the deposit exists to
// prevent. So `downpaymentUnavailable` blocks the Place button outright when a
// deposit is due and no method carries `purpose = 'kahati_downpayment'`.
//
// Which means the moment an admin saves a deposit policy without first adding a
// deposit QR, EVERY kahati checkout stops dead, and the only signal is customers
// reporting they cannot order. The live database is one save away from that
// right now: a policy has never been configured, and all four payment methods
// are `purpose = 'full'`.
//
// The refusal belongs at the write, where an admin is present to read it.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, paymentMethods } from '@/lib/db';
import { resetDb } from '@/lib/test/harness';
import { getKahatiDownpaymentPolicy, setKahatiDownpaymentPolicy } from '@/lib/settings';
import { DEFAULT_KAHATI_DOWNPAYMENT_POLICY } from '@/lib/kahati-downpayment';

const addMethod = async (
  opts: { label: string; purpose: string; isActive?: boolean },
) => {
  const db = await getDb();
  await db.insert(paymentMethods).values({
    label: opts.label, accountName: 'BBG', accountNumber: '0917-000',
    purpose: opts.purpose, isActive: opts.isActive ?? true,
  });
};

const FIXED = { mode: 'fixed', amountPhp: 500, percent: 0, refundable: true, policyNote: null } as const;
const PERCENT = { mode: 'percent', amountPhp: 0, percent: 20, refundable: true, policyNote: null } as const;

beforeEach(resetDb);

describe('saving a kahati deposit policy without a deposit QR', () => {
  it('refuses a flat deposit when no downpayment method exists', async () => {
    await addMethod({ label: 'GCash', purpose: 'full' });

    await expect(setKahatiDownpaymentPolicy(FIXED)).rejects.toThrow(/downpayment (method|qr)/i);
  });

  it('refuses a percentage deposit for the same reason', async () => {
    await addMethod({ label: 'BDO', purpose: 'full' });

    await expect(setKahatiDownpaymentPolicy(PERCENT)).rejects.toThrow(/downpayment (method|qr)/i);
  });

  it('leaves the stored policy untouched when it refuses', async () => {
    // A half-applied change is worse than a refused one: checkout would read the
    // new mode and block on it.
    await addMethod({ label: 'GCash', purpose: 'full' });

    await expect(setKahatiDownpaymentPolicy(FIXED)).rejects.toThrow();

    expect(await getKahatiDownpaymentPolicy()).toEqual(DEFAULT_KAHATI_DOWNPAYMENT_POLICY);
  });

  it('does not count an INACTIVE downpayment method — checkout cannot offer it either', async () => {
    // The checkout list filters on is_active, so a switched-off row is no more
    // reachable than a missing one.
    await addMethod({ label: 'Old Deposit QR', purpose: 'kahati_downpayment', isActive: false });

    await expect(setKahatiDownpaymentPolicy(FIXED)).rejects.toThrow(/downpayment (method|qr)/i);
  });

  it('allows the deposit once an active downpayment method is there', async () => {
    await addMethod({ label: 'GCash Deposits', purpose: 'kahati_downpayment' });

    const saved = await setKahatiDownpaymentPolicy(FIXED);

    expect(saved.mode).toBe('fixed');
    expect(saved.amountPhp).toBe(500);
  });

  it('still allows the packing-fee rule with no downpayment method at all', async () => {
    // That rule collects no deposit — it is paid through the ordinary methods,
    // exactly as it did before this feature existed. Requiring a deposit QR to
    // turn the deposit OFF would lock an admin out of their own escape hatch.
    await addMethod({ label: 'GCash', purpose: 'full' });

    const saved = await setKahatiDownpaymentPolicy(DEFAULT_KAHATI_DOWNPAYMENT_POLICY);

    expect(saved).toEqual(DEFAULT_KAHATI_DOWNPAYMENT_POLICY);
  });

  it('lets an admin switch back to the packing-fee rule after a deposit was configured', async () => {
    // The way out of a misconfiguration, which must not itself be gated.
    await addMethod({ label: 'GCash Deposits', purpose: 'kahati_downpayment' });
    await setKahatiDownpaymentPolicy(FIXED);

    const db = await getDb();
    await db.delete(paymentMethods).where(eq(paymentMethods.purpose, 'kahati_downpayment'));

    const saved = await setKahatiDownpaymentPolicy(DEFAULT_KAHATI_DOWNPAYMENT_POLICY);
    expect(saved.mode).toBe('packing_fee');
  });
});
