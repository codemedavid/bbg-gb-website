'use client';
import { OrdersBoard } from '../OrdersBoard';

// Campaign commitments and MOQ pre-orders. Both are ordered from the supplier,
// so they share a board — the same split lib/report/segment.ts makes.
export default function AdminGroupBuyOrdersPage() {
  return <OrdersBoard segment="groupbuy" />;
}
