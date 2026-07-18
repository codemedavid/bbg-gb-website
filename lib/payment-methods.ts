import { signedUrl } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';

type PaymentMethodRow = {
  id: string; label: string; accountName: string; accountNumber: string;
  qrKey: string | null; isActive: boolean; sortOrder: number;
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
    isActive: m.isActive,
    sortOrder: m.sortOrder,
  };
}
