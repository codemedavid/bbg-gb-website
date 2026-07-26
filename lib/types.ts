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
  minVials: number; repackFeePhp: string; status: 'open' | 'closed' | 'shipped' | 'completed' | 'cancelled';
  closesAt: string | null; arrivalGroup: 'white_powder' | 'salt_liquid'; description: string | null;
  perVialPhp: number; remaining: number; progress: number;
};

// A product on the MOQ shelf — its own surface, distinct from both the Kahati
// board (GroupBuy) and the Group Buy campaign board (MoqCampaign).
export type MoqProduct = {
  id: string; name: string; spec: string; description: string | null;
  imageUrl: string | null; imageEmoji: string | null;
  pricePhp: string; priceUsd: string | null;
  stock: number; minOrderQty: number; packingFeePhp: string | null;
  arrivalGroup: 'white_powder' | 'salt_liquid';
  isActive: boolean; sortOrder: number;
  // Derived server-side: in stock AND holding at least one whole minimum order.
  inStock: boolean;
};

export type IncludedProduct = { productId: string; name: string; outOfStock?: boolean };

export type MoqCampaign = {
  id: string; name: string; pricePerKitPhp: string; moq: number; committed: number;
  shippingPhp: string; status: 'open' | 'approved' | 'cancelled';
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
  id?: string; name: string; pricePerKitPhp: number; moq: number;
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
  // Mirrors the order_item_kind enum — see lib/types-order-modes.test.ts.
  id: string; kind: 'product' | 'group_buy' | 'moq_campaign' | 'moq_product';
  nameSnapshot: string; specSnapshot: string | null;
  unitPricePhp: string; unitPriceUsd?: string | null; qty: number; lineTotalPhp: string;
};
export type Order = {
  // Mirrors the buy_type enum — see lib/types-order-modes.test.ts.
  id: string; orderNo: string; status: string; buyType: 'solo' | 'kahati' | 'group_buy' | 'moq';
  // packingFeePhp is the single fee (local shipping incl.). shipping/repack remain for legacy orders.
  subtotalPhp: string; packingFeePhp: string; shippingPhp?: string; repackFeePhp?: string; totalPhp: string;
  // Kahati reservation downpayment paid at checkout; balance = total - downpayment. 0 for solo.
  downpaymentPhp?: string;
  shipName: string; shipPhone: string; shipAddress: string; trackingNo: string | null;
  // Weekly-report fulfilment fields (admin-editable). paymentMethod drives the Payment column.
  paymentMethod?: string | null; courier?: string | null; packedBy?: string | null; totalUsd?: string;
  // The final checkout that settled this order's balance and packing fee; null
  // while either is still outstanding.
  settlementId?: string | null;
  createdAt: string; items?: OrderItem[];
};
export type OrderHistory = { id: string; status: string; note: string | null; createdAt: string };

// A payment obligation as the customer and admin see it.
export type PaymentState = 'paid' | 'under_review' | 'unpaid' | 'cancelled';

// One completed hatian order awaiting its final payment, as quoted by
// GET /api/settlements/preview.
export type SettlementOrder = {
  id: string; orderNo: string; status: string;
  totalPhp: number; downpaymentPhp: number; packingFeePhp: number;
  hatianPackingFeePhp: number; hatianNames: string[];
  packingFee: PaymentState; createdAt: string;
};

// The whole final checkout: every settleable order, and the ONE packing fee
// charged for the parcel no matter how many hatians it spans.
export type SettlementPreview = {
  orders: SettlementOrder[];
  totals: { balancePhp: number; packingFeePhp: number; totalPhp: number };
};

// One participant's commitment to a hatian, as the admin panel lists it. The
// three payments are separate: a customer may have paid their downpayment and
// still owe both the balance and the packing fee.
export type HatianCommitment = {
  orderId: string; orderNo: string; orderStatus: string;
  customerName: string; customerEmail: string; customerPhone: string | null;
  vials: number; committedAt: string;
  balancePhp: number; downpaymentPhp: number;
  downpayment: PaymentState; finalPayment: PaymentState; packingFee: PaymentState;
  settledAt: string | null;
};

export type Settlement = {
  id: string; status: 'proof_review' | 'paid' | 'cancelled';
  packingFeePhp: string; balancePhp: string; totalPhp: string;
  paymentMethod: string | null; createdAt: string; paidAt: string | null;
};

export type User = { id: string; name: string; email: string; phone: string | null; address: string | null; role: 'customer' | 'admin' };
