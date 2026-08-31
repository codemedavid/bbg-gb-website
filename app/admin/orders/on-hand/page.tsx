'use client';
import { OrdersBoard } from '../OrdersBoard';

// Sales fulfilled from stock already in the stockroom — nothing here is waiting
// on the supplier.
export default function AdminOnHandOrdersPage() {
  return <OrdersBoard segment="onhand" />;
}
