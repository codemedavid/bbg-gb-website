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
