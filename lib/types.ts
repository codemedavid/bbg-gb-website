export type Category = { id: string; name: string; slug: string; sortOrder: number };

export type Product = {
  id: string; code: string | null; name: string; spec: string;
  pricePhp: string; priceUsd: string | null; categoryId: string | null;
  categorySlug: string | null; categoryName: string | null;
  isOnHand: boolean; onHandKitPhp: string | null; onHandPiecePhp: string | null;
  stock: number;
  /** Vials per supplier kit; drives the weekly report's Kits column. */
  kitSize: number;
  arrivalGroup: 'white_powder' | 'salt_liquid';
  description: string | null; imageEmoji: string | null; soldCount: number;
  isActive?: boolean;
  coaFiles?: CoaFile[];
  // Group buy terms that belong to the PRODUCT: a hatian or a campaign carrying
  // it seeds itself from these rather than making the admin retype them per
  // batch. Named exactly as lib/db/schema.ts and pricing.ts's GroupBuyConfig
  // name them, so an admin row satisfies that contract with no adapter.
  //
  // Optional because the public catalog feeds select a narrower column list —
  // these are admin-surface fields and the storefront never reads them.
  isGroupBuy?: boolean;
  // Group Buy only — not sold per vial, so no hatian counter may exist for it
  // (lib/kahati-eligibility.ts).
  isKahati?: boolean;
  gbPricePerKitPhp?: string | null;
  gbPricePerPiecePhp?: string | null;
  gbVialsPerKit?: number | null;
  gbMinVials?: number | null;
  gbMaxVialsPerBatch?: number | null;
};
export type CoaFile = { id: string; productId: string; batch: string | null; fileName: string; storageKey: string };

export type GroupBuy = {
  id: string; name: string; pricePerKitPhp: string; totalSlots: number; claimedSlots: number;
  minVials: number; repackFeePhp: string;
  status: 'scheduled' | 'open' | 'closed' | 'shipped' | 'completed' | 'cancelled';
  // When the counter goes on the board; null means it already is.
  opensAt: string | null;
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

// A product inside a campaign, with the group buy terms the admin set for it
// there. Every term is optional: an absent one means the campaign says nothing
// about it and the product's own saved setting stands.
export type IncludedProduct = {
  productId: string; name: string; outOfStock?: boolean;
  pricePerKitPhp?: number; pricePerPiecePhp?: number;
  minOrderQty?: number; maxBatchKits?: number; vialsPerKit?: number;
};

// One BATCH of a group buy. A campaign that outgrows its 10-kit cap continues as
// batch #2, #3, … of the same series, so the board lists batches, not campaigns.
export type MoqCampaign = {
  id: string; name: string; pricePerKitPhp: string; moq: number; committed: number;
  // Admin-set floor on one customer's commitment; the cart seeds the line here.
  perCustomerMin: number;
  shippingPhp: string; status: 'scheduled' | 'open' | 'approved' | 'completed' | 'cancelled';
  // When the batch goes on the board; null means it already is.
  opensAt: string | null;
  deadline: string | null; includedProducts: IncludedProduct[];
  arrivalGroup: 'white_powder' | 'salt_liquid'; description: string | null; createdAt: string;
  // Which batch of which series this row is. seriesId resolves to the row's own
  // id for a first batch, so grouping by it always yields the whole series.
  seriesId: string; batchNo: number;
  // Derived server-side.
  capacity: number;  // kits this batch holds — the denominator the UI shows
  progress: number;  // 0..1
  remaining: number; reached: boolean; full: boolean;
  outcome: 'awaiting_moq' | 'processing' | 'refunded';
};

// Shape sent to POST /campaigns (create) and PATCH /campaigns/:id (edit).
// Numeric prices are serialized as numbers; the API coerces to its numeric columns.
// `status` is intentionally omitted — it is lifecycle-owned (see /campaigns/:id/action).
export type CampaignPayload = {
  id?: string; name: string; pricePerKitPhp: number; moq: number;
  shippingPhp: number; opensAt: string | null; deadline: string | null; includedProducts: IncludedProduct[];
  arrivalGroup: 'white_powder' | 'salt_liquid'; description: string | null;
};

export type PaymentMethod = {
  id: string; label: string; accountName: string; accountNumber: string;
  qrUrl: string | null; isActive: boolean; sortOrder: number;
};

// Shape returned by the public /payment-methods endpoint (active methods only).
export type CheckoutPaymentMethod = Pick<PaymentMethod, 'id' | 'label' | 'accountName' | 'accountNumber' | 'qrUrl'>;

/**
 * One uploaded proof of payment. An order may carry up to five
 * (lib/proof.ts MAX_PROOFS), because a bank transfer cap turns one payment
 * into several.
 *
 * `amountPhp` and `reference` are filled in by the admin while reconciling
 * against the bank statement, so both are null on a freshly placed order.
 */
export type PaymentProof = {
  id: string;
  url: string;
  sortOrder: number;
  amountPhp: string | null;
  reference: string | null;
};

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
  // Kahati amount paid at checkout. The order total already includes it as the
  // added packing-fee line; balance views subtract it only from the amount still
  // to collect. 0 for non-kahati orders.
  downpaymentPhp?: string;
  shipName: string; shipPhone: string; shipAddress: string; trackingNo: string | null;
  // Weekly-report fulfilment fields (admin-editable). paymentMethod drives the Payment column.
  paymentMethod?: string | null; courier?: string | null; packedBy?: string | null; totalUsd?: string;
  // The final checkout that settled this order's balance and packing fee; null
  // while either is still outstanding. settlementStatus distinguishes a proof
  // awaiting verification from a confirmed payment — the id alone does not.
  settlementId?: string | null;
  settlementStatus?: 'proof_review' | 'paid' | 'cancelled' | null;
  // The instructions the customer wrote in the cart before checking out. Shown
  // back to them so they can confirm what they asked for, and to the admin who
  // has to act on it.
  notes?: string | null;
  createdAt: string; items?: OrderItem[];
};
export type OrderHistory = { id: string; status: string; note: string | null; createdAt: string };

// What GET /api/orders/[id] answers: one order, whole, as the details page
// renders it. The customer block is joined from the user record because the
// email is not on the order; the SHIPPING fields stay on `order` because the
// order's own snapshot is where the parcel actually went.
export type OrderDetail = {
  order: Order & { courier?: string | null; notes?: string | null };
  customer: { name: string | null; email: string | null; phone: string | null };
  items: OrderItem[];
  history: OrderHistory[];
  /** Signed, expiring URL for the FIRST payment proof; null when none. */
  proofUrl: string | null;
  /**
   * Every proof the order carries, oldest first. The customer needs the whole
   * list to tell whether last night's upload landed before deciding to add
   * another. Optional so a cached response from before this shipped still
   * types.
   */
  proofs?: PaymentProof[];
};

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

// What GET /api/kahati/commitments answers: the kahati lines this customer
// already holds, and whether an open one among them means the reservation
// downpayment is already covered (see lib/kahati-commitment.ts).
export type KahatiCommitments = {
  commitments: KahatiCommitment[];
  summary: {
    groups: { kahatiName: string; vials: number; totalPhp: number; orderNos: string[] }[];
    vials: number;
    totalPhp: number;
    orderCount: number;
  };
  paidThisCycle: boolean;
};

export type KahatiCommitment = {
  orderId: string; orderNo: string;
  kahatiId: string; kahatiName: string; kahatiStatus: string;
  qty: number; lineTotalPhp: number; placedAt: string;
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
// This is the contract for GET /admin/groupbuys/[id]/commitments, and the route
// annotates its rows with it — a field renamed on one side is now a compile
// error, not a panel that reads undefined and throws in the browser.
export type HatianCommitment = {
  orderId: string; orderNo: string; orderStatus: string;
  customerName: string; customerEmail: string; customerPhone: string | null;
  // Where the parcel is going, read off the order's delivery snapshot rather
  // than the user record: an address edited after committing must not rewrite
  // where an already-packed batch was shipped.
  contactPhone: string; shippingAddress: string;
  vials: number; committedAt: string;
  // The balance of the whole ORDER, not of this counter's share. A commitment
  // that overflowed into a sibling counter reports the same figure under both,
  // which is what spansOtherHatians warns about.
  orderBalancePhp: number; spansOtherHatians: boolean; downpaymentPhp: number;
  // What has actually cleared, as opposed to what was quoted. A proof still
  // under review is not money received, so it counts for nothing here.
  amountPaidPhp: number;
  downpayment: PaymentState; finalPayment: PaymentState; packingFee: PaymentState;
  // How they paid, and a URL for the proof they uploaded. Proofs are private, so
  // the storage key never reaches the browser — only a signed, fetchable URL.
  paymentMethod: string | null; proofUrl: string | null;
  settledAt: string | null;
};

// A settlement as the admin list renders it: the row plus who it belongs to and
// how many hatian orders the one packing fee covered.
export type AdminSettlement = {
  id: string; status: 'proof_review' | 'paid' | 'cancelled';
  packingFeePhp: string; balancePhp: string; totalPhp: string;
  paymentMethod: string | null; paymentProofKey: string | null;
  /**
   * Every proof this settlement carries, oldest first. paymentProofKey above is
   * the first of them, kept for readers that have not moved to the list.
   */
  proofs?: PaymentProof[];
  createdAt: string; paidAt: string | null;
  customerName: string | null; customerEmail: string | null;
  orderCount: number;
};

export type Settlement = {
  id: string; status: 'proof_review' | 'paid' | 'cancelled';
  packingFeePhp: string; balancePhp: string; totalPhp: string;
  paymentMethod: string | null; createdAt: string; paidAt: string | null;
};

export type User = { id: string; name: string; email: string; phone: string | null; address: string | null; role: 'customer' | 'admin' };
