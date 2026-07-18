export type Category = { id: string; name: string; slug: string; sortOrder: number };

export type Product = {
  id: string; code: string | null; name: string; spec: string;
  pricePhp: string; priceUsd: string | null; categoryId: string | null;
  categorySlug: string | null; categoryName: string | null;
  isOnHand: boolean; onHandKitPhp: string | null; onHandPiecePhp: string | null;
  stock: number; arrivalGroup: 'white_powder' | 'salt_liquid';
  description: string | null; imageEmoji: string | null; soldCount: number;
  isActive?: boolean;
  coaFiles?: CoaFile[];
};
export type CoaFile = { id: string; productId: string; batch: string | null; fileName: string; storageKey: string };

export type GroupBuy = {
  id: string; name: string; pricePerKitPhp: string; totalSlots: number; claimedSlots: number;
  minVials: number; repackFeePhp: string; status: 'open' | 'closed' | 'shipped' | 'completed';
  closesAt: string | null; arrivalGroup: 'white_powder' | 'salt_liquid'; description: string | null;
  perVialPhp: number; remaining: number; progress: number;
};

export type IncludedProduct = { productId: string; name: string; outOfStock?: boolean };

export type MoqCampaign = {
  id: string; name: string; pricePerKitPhp: string; moq: number; committed: number;
  perCustomerMin: number; shippingPhp: string; status: 'open' | 'approved' | 'cancelled';
  deadline: string | null; includedProducts: IncludedProduct[];
  arrivalGroup: 'white_powder' | 'salt_liquid'; description: string | null; createdAt: string;
  // Derived server-side.
  progress: number; // 0..1
  remaining: number; reached: boolean;
  outcome: 'awaiting_moq' | 'processing' | 'refunded';
};

// Shape sent to POST /campaigns (create) and PATCH /campaigns/:id (edit).
// Numeric prices are serialized as numbers; the API coerces to its numeric columns.
// `status` is intentionally omitted — it is lifecycle-owned (see /campaigns/:id/action).
export type CampaignPayload = {
  id?: string; name: string; pricePerKitPhp: number; moq: number; perCustomerMin: number;
  shippingPhp: number; deadline: string | null; includedProducts: IncludedProduct[];
  arrivalGroup: 'white_powder' | 'salt_liquid'; description: string | null;
};

export type PaymentMethod = {
  id: string; label: string; accountName: string; accountNumber: string;
  qrUrl: string | null; isActive: boolean; sortOrder: number;
};

// Shape returned by the public /payment-methods endpoint (active methods only).
export type CheckoutPaymentMethod = Pick<PaymentMethod, 'id' | 'label' | 'accountName' | 'accountNumber' | 'qrUrl'>;

export type OrderItem = {
  id: string; kind: 'product' | 'group_buy'; nameSnapshot: string; specSnapshot: string | null;
  unitPricePhp: string; qty: number; lineTotalPhp: string;
};
export type Order = {
  id: string; orderNo: string; status: string; buyType: 'solo' | 'kahati';
  subtotalPhp: string; shippingPhp: string; repackFeePhp: string; totalPhp: string;
  shipName: string; shipPhone: string; shipAddress: string; trackingNo: string | null;
  createdAt: string; items?: OrderItem[];
};
export type OrderHistory = { id: string; status: string; note: string | null; createdAt: string };

export type User = { id: string; name: string; email: string; phone: string | null; address: string | null; role: 'customer' | 'admin' };
