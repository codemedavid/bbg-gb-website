import { signedUrl } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';
import { asPaymentPurpose } from '@/lib/payment-purpose';

type PaymentMethodRow = {
  id: string; label: string; accountName: string; accountNumber: string;
  qrKey: string | null; isActive: boolean; sortOrder: number;
  // Both absent on a row read back from a database that predates migration
  // 0027, and on the fixtures of tests written before it. Optional here so a
  // partial row still serializes rather than throwing inside a list endpoint.
  purpose?: string | null; instructions?: string | null;
};

// Resolves a stored payment-method row into the client shape, turning the QR
// storage key into a served/signed URL (null when no QR has been uploaded).
export async function serializePaymentMethod(m: PaymentMethodRow) {
  return {
    id: m.id,
    label: m.label,
    accountName: m.accountName,
    accountNumber: m.accountNumber,
    qrUrl: m.qrKey ? await signedUrl(BUCKETS.qr, m.qrKey) : null,
    purpose: asPaymentPurpose(m.purpose),
    instructions: m.instructions ?? null,
    isActive: m.isActive,
    sortOrder: m.sortOrder,
  };
}
