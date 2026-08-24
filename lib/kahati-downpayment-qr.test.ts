// Installing the hatian downpayment QR.
//
// The QR that MariBank/InstaPay generates is locked to a fixed peso amount, and
// that is the whole reason this module exists rather than a couple of ad-hoc
// INSERTs. A QR locked to ₱150 sitting behind a policy that quotes the packing
// fee is a customer sending the wrong number and an admin reconciling by hand,
// so the image and the amount are installed in ONE operation that cannot leave
// them disagreeing.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { resetDb } from '@/lib/test/harness';
import { getDb, paymentMethods } from '@/lib/db';
import { getKahatiDownpaymentPolicy, setKahatiDownpaymentPolicy } from '@/lib/settings';
import { readLocal } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';
import { installKahatiDownpaymentQr } from './kahati-downpayment-qr';

// A real 1x1 PNG: validateAndStoreImage checks the declared type, and the
// round-trip assertion below needs bytes it can compare.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let imagePath: string;

const BASE = {
  label: 'MariBank',
  accountName: 'BBG Peptides',
  accountNumber: 'Scan the QR (InstaPay)',
  amountPhp: 150,
};

beforeEach(async () => {
  await resetDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kahati-qr-'));
  imagePath = path.join(dir, 'maribank.png');
  fs.writeFileSync(imagePath, PNG);
});

const activeDownpaymentMethods = async () => {
  const db = await getDb();
  return db.select().from(paymentMethods).where(eq(paymentMethods.purpose, 'kahati_downpayment'));
};

describe('installing the kahati downpayment QR', () => {
  it('stores the image and marks the method as a downpayment method', async () => {
    const { methodId, qrKey } = await installKahatiDownpaymentQr({ ...BASE, imagePath });

    const [row] = await activeDownpaymentMethods();
    expect(row.id).toBe(methodId);
    expect(row.label).toBe('MariBank');
    expect(row.qrKey).toBe(qrKey);
    expect(row.isActive).toBe(true);
    expect(await readLocal(BUCKETS.qr, qrKey)).toEqual(PNG);
  });

  it('quotes exactly the amount the QR is locked to', async () => {
    await installKahatiDownpaymentQr({ ...BASE, imagePath });

    const policy = await getKahatiDownpaymentPolicy();
    expect(policy.mode).toBe('fixed');
    expect(policy.amountPhp).toBe(150);
  });

  it('keeps the admin’s own refund wording when the QR is re-pointed', async () => {
    await setKahatiDownpaymentPolicy({
      mode: 'packing_fee', amountPhp: 0, percent: 0,
      refundable: false, policyNote: 'Rolled over to your next hatian.',
    });

    await installKahatiDownpaymentQr({ ...BASE, imagePath });

    const policy = await getKahatiDownpaymentPolicy();
    expect(policy.refundable).toBe(false);
    expect(policy.policyNote).toBe('Rolled over to your next hatian.');
  });

  it('replaces the same method on a second run instead of stacking a second QR', async () => {
    const first = await installKahatiDownpaymentQr({ ...BASE, imagePath });
    const second = await installKahatiDownpaymentQr({ ...BASE, imagePath, amountPhp: 200 });

    const rows = await activeDownpaymentMethods();
    expect(rows).toHaveLength(1);
    expect(second.methodId).toBe(first.methodId);
    expect((await getKahatiDownpaymentPolicy()).amountPhp).toBe(200);
  });

  it('leaves full-payment methods alone, so the balance still settles against the default QR', async () => {
    const db = await getDb();
    await db.insert(paymentMethods).values({
      label: 'GCash', accountName: 'BBG Peptides', accountNumber: '0917-000-0000',
      qrKey: 'existing.png', purpose: 'full',
    });

    await installKahatiDownpaymentQr({ ...BASE, imagePath });

    const [gcash] = await db.select().from(paymentMethods).where(eq(paymentMethods.purpose, 'full'));
    expect(gcash.qrKey).toBe('existing.png');
    expect(gcash.isActive).toBe(true);
  });
});
