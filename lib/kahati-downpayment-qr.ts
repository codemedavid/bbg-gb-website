// Points the hatian downpayment at a real QR image, amount and all.
//
// A bank-issued InstaPay/QRPH code is usually locked to a FIXED peso amount —
// the ₱150 printed under the MariBank code is encoded in the code itself, not
// decoration. That makes the image and the downpayment policy a single decision:
// upload the QR without moving the policy and the checkout quotes the packing
// fee while the customer's banking app insists on ₱150, which is a support
// ticket per order and a manual reconciliation at the end of the cycle.
//
// So this installs both in one call. It exists as a library function rather than
// as SQL in a script so the guarantee is testable (lib/kahati-downpayment-qr.test.ts)
// and so the same operation works against local PGlite, Supabase, or ImageKit —
// whichever DATABASE_URL and STORAGE_DRIVER are pointing at.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb, paymentMethods } from '@/lib/db';
import { putFile } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';
import { getKahatiDownpaymentPolicy, setKahatiDownpaymentPolicy } from '@/lib/settings';
import type { KahatiDownpaymentPolicy } from '@/lib/kahati-downpayment';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

export type KahatiDownpaymentQrInstall = {
  /** Path on disk to the QR image to upload. */
  imagePath: string;
  /** The method's name at checkout, and the key this install upserts on. */
  label: string;
  accountName: string;
  accountNumber: string;
  /** The peso amount the QR is locked to. The policy is set to collect exactly this. */
  amountPhp: number;
  /** Optional line shown under the QR ("send the exact amount"). */
  instructions?: string | null;
};

export type KahatiDownpaymentQrResult = {
  methodId: string;
  qrKey: string;
  policy: KahatiDownpaymentPolicy;
};

export async function installKahatiDownpaymentQr(
  opts: KahatiDownpaymentQrInstall,
): Promise<KahatiDownpaymentQrResult> {
  const ext = path.extname(opts.imagePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    throw new Error(`Unsupported QR image type "${ext || opts.imagePath}" — use PNG, JPG, or WebP.`);
  }
  if (!(opts.amountPhp > 0)) {
    throw new Error(`Downpayment amount must be a positive number of pesos, got ${opts.amountPhp}.`);
  }

  const body = await fs.readFile(opts.imagePath);
  const qrKey = `${randomUUID()}${ext}`;
  await putFile(BUCKETS.qr, qrKey, body, contentType);

  const db = await getDb();
  const fields = {
    accountName: opts.accountName,
    accountNumber: opts.accountNumber,
    qrKey,
    instructions: opts.instructions ?? null,
    isActive: true,
  };

  // Upserted on (label, purpose) rather than on purpose alone. Re-running this
  // for MariBank must not stack a second MariBank QR on the downpayment screen,
  // but the business is free to offer a GCash downpayment QR alongside it — the
  // checkout renders a list — so a different label deliberately adds a row
  // instead of replacing the one already there.
  const [existing] = await db.select().from(paymentMethods).where(
    and(eq(paymentMethods.label, opts.label), eq(paymentMethods.purpose, 'kahati_downpayment')),
  );

  const [row] = existing
    ? await db.update(paymentMethods).set(fields).where(eq(paymentMethods.id, existing.id)).returning()
    : await db.insert(paymentMethods).values({
        label: opts.label, purpose: 'kahati_downpayment', sortOrder: 0, ...fields,
      }).returning();

  // Only the mode and the amount move. Whether a cancelled kit refunds, and the
  // admin's own wording for it, are policy the business decided elsewhere —
  // re-pointing a QR is not the moment to silently reset either.
  const current = await getKahatiDownpaymentPolicy();
  const policy = await setKahatiDownpaymentPolicy({
    ...current, mode: 'fixed', amountPhp: opts.amountPhp,
  });

  return { methodId: row.id, qrKey, policy };
}
